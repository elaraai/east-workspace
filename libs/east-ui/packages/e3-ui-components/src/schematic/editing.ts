/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's editing (#1388, `Schematic Builder Spec.md` §7): one history
 * over a session per record it writes — each kind bound with its patch door,
 * its items, zones, links and nets alike, and each kind's details so bound —
 * through the shared Schedule editing (`shared/schedule/editing.ts`'
 * `useScheduleEditing`), as the Roster's and the Allocation's are. A gesture
 * is one step across the records it changes; Save sends each record's changes
 * as its own request through its patch door, and a conflict or a refusal
 * keeps that record's drafts and leaves the others' commits standing (SC6).
 *
 * - **Its reads.** A kind read whole is a session over its record's
 *   snapshot. A kind read through its source of the slice is read by key
 *   through its `entries`: what its source's read holds, kept at the revision
 *   it was read at, serves a gesture's original and a Save's confirmation, and
 *   a row it does not hold is read by its key. A kind read by area (#1393) is
 *   the same, its window's rows serving while they are at the record's
 *   revision, and then the rows the paged Backlog's pages read at it — a drop
 *   placing one records at once. Drafts of rows the narrowing hides, or the
 *   window does not hold, stay in their sessions, and Save sends them (SC23).
 * - **Its writes.** A gesture's edits (`edits.ts`) go through the kinds' own
 *   functions: an existing row is rewritten from the row as its session finds
 *   it — drafted, else as the record holds it — through its kind's `write`, so
 *   only its roles' fields move (SC2); a new row is its kind's `create`, under
 *   the key its kind makes (`newKey`, below); a deleted one is removed. A drop (#1390) writes the same
 *   way: a template's new item through its kind's `create`; a link or net
 *   template's values over a link or a net through its kind's `create` over
 *   the ends or the sides its row holds, so they and its key stay as they are
 *   (SC11); an author's card's fields through its kind's `set`. The
 *   inspector's (#1391) the same: a field of its form through the `set` of
 *   the row's record or its details record, and the row a kind's own Details
 *   hands back, whole. A gesture any of whose rows its kind refuses records
 *   nothing.
 * - **A new row's key (#1549)** is its kind's to make (`newKey`): built from
 *   the row by the kind's `key`; else, keyed by String, minted unique among
 *   every key the Schematic has read and drafted (`mintKey`, SC7); by Integer,
 *   one past the largest the record, the drafts and the gesture hold — a kind
 *   read by key asking its record for its largest; by any type the form types,
 *   a placeholder — a text minted that no key prints as — which holds Save
 *   until the viewer types its key in the inspector, the app's check asked of
 *   the rows under keys alone; and by any other, none: the kind adds no row
 *   (`untyped`). A row whose kind builds its key from its fields moves under
 *   the key a gesture's edit of them builds (`moves`), its details row with it.
 * - **A number its field's bounds don't hold (#1585).** Each record's form
 *   goes with it (`fields`): a changed row whose number is under its least or
 *   over its most holds Save, as the app's check does, and Issues names it.
 * - **Its drafts.** Each draft is decoded once: its roles read through its
 *   kind's `read` — a row under a placeholder as keyed by its key type's
 *   default — and the roles of the row its session began from beside
 *   them, kept while its session keeps the entry's version — what the frame
 *   draws over the stored rows (`drafted.ts`), and where a kind read by area's
 *   Backlog lists it (`backlog.ts`).
 * - **What stands in.** While what the canvas draws stands in for a new
 *   narrowing, or a narrowing the frame follows could not be read, it is
 *   retained (#1398, CL8): no record takes an edit — every route asks
 *   `available`, and `record` records nothing — until it lands. The history's
 *   Undo, Redo, Discard and Save stay live.
 *
 * A Schematic read only (`readOnly`) has no session, nor has a kind bound read
 * only (SC14).
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { StringType, equalFor, some, variant, type EastTypeValue, type ValueTypeOf, type option } from "@elaraai/east";
import type { EditingReadinessType, RecordSliceBindType } from "@elaraai/east-ui/internal";
import type { EditHistory, EntryVersion, Origin } from "@elaraai/east-ui-components";
import {
    useScheduleEditing,
    type ScheduleChange, type ScheduleEditing, type ScheduleEditingKind, type ScheduleEditingRecord, type ScheduleEntryRef, type ScheduleRowRead,
} from "../shared/schedule/editing.js";
import { kindKeys, type KindKeys } from "../shared/schedule/kind-keys.js";
import { draftedRow, heldInWindow, keptAtRevision, madeFromValues, mintKey, rowCodec } from "../shared/schedule/records.js";
import type { SchematicRef } from "./canvas/drawn.js";
import type { SchematicHeldRows, SchematicValue, SchematicWindowRows } from "./data.js";
import type { DraftedRow, SchematicDrafts, SortDrafts } from "./drafted.js";
import type { SchematicEdit } from "./edits.js";
import { detailsKey } from "./record-keys.js";

const stringEqual = equalFor(StringType);

/** No event kind: the Schematic writes its kinds a whole row at a time, as records. */
const NO_KINDS: readonly ScheduleEditingKind[] = [];

/** No session made elsewhere joins the Schematic's history. */
const NO_JOINED: Parameters<typeof useScheduleEditing>[0]["joined"] = [];

// What the history names each record by: pure, in a module of its own, so what reads it needs no editing.
export { detailsKey, recordSlot } from "./record-keys.js";

/** A drafted row's readiness, as a kind's check gives it. */
type Readiness = ValueTypeOf<typeof EditingReadinessType>;

/** What the Schematic's editing says of a new row's key (#1549). */
export interface SchematicKeyWords {
    /** A new row held under a placeholder, its key still to be typed — `Type this rack's key: Save waits for it`; `name` is its kind's. */
    readonly placeholder: (p: { name: string }) => string;
}

/** A new row's key, as its kind makes it (#1549). */
export type SchematicNewKey =
    /** Its key: built from its row, minted, one past the largest, or a placeholder until the viewer types its key. */
    | { readonly key: string }
    /** None: the key its row builds is held already, by the row of that key. */
    | { readonly taken: string }
    /** None: its kind's keys are of a type the form can't type — by the type's name — and its kind builds none. */
    | { readonly untyped: string };

/** A row a gesture moves under the key its fields build once the gesture writes them (#1549). */
export interface SchematicMove {
    /** The row. */
    readonly ref: SchematicRef;
    /** The key its row builds after the gesture. */
    readonly to: string;
}

/** The Schematic's editing: its history, every kind's drafts, and how a gesture is recorded. */
export interface SchematicEditing {
    /** The shared Schedule editing over the records: each one's session, and what each holds. */
    readonly schedule: ScheduleEditing;
    /** The one history over them. */
    readonly history: EditHistory<ScheduleEntryRef>;
    /** Whether any record is edited: a kind or a details record bound with its patch door, and the Schematic not read only. */
    readonly edits: boolean;
    /** Every kind's drafts, by sort, each decoded once. */
    readonly drafts: SchematicDrafts;
    /** The history's version: it moves with every change of it or of its sessions. */
    readonly version: number;
    /**
     * Whether a record takes an edit now: its session takes one, and nothing the canvas draws is retained (#1398, CL8).
     *
     * @param record - The record's key in the history: a kind's slot, or its details' (`detailsKey`)
     * @returns Whether it takes one
     */
    available(record: string): boolean;
    /**
     * Records one gesture's edits as one step of the history.
     *
     * @param edits - The rows it changes, and how
     * @param origin - The gesture
     * @param label - Its label in the history
     * @returns Whether anything was recorded: nothing is when a kind refuses a row, a row's read is in flight, or what the
     *   canvas draws is retained
     */
    record(edits: readonly SchematicEdit[], origin: Origin, label: string): boolean;
    /**
     * Whether a record is edited at all: a kind or a details record bound with its patch door, and the Schematic not read
     * only (SC14).
     *
     * @param record - The record's key in the history: a kind's slot, or its details' (`detailsKey`)
     */
    edited(record: string): boolean;
    /**
     * A new row's key, as its kind makes one (#1549; the module docs): built from the row the edit makes, by the kind's
     * `key`, refused where a row stands under it; else, keyed by String, minted unique (SC7); by Integer, one past the
     * largest; by a type the form types, a placeholder; by any other, none.
     *
     * @param made - The edit making the row — an item's, a link's or a net's — under any key: its kind's, and the row the
     *   kind's `key` builds a key from
     * @param minted - The keys the gesture has made already
     * @returns The key, or why there is none; `undefined` while a kind read by key asks its record for its largest, or
     *   where the kind makes no row of the edit
     */
    newKey(made: SchematicEdit, minted?: ReadonlySet<string>): SchematicNewKey | undefined;
    /**
     * Whether the Schematic holds a key of a kind already: read, or drafted — a new row's among them. A kind read by key
     * knows the keys its reads hold: a key e3 holds unread is its Save's conflict.
     *
     * @param slot - The kind's slot
     * @param key - The key's text
     */
    taken(slot: string, key: string): boolean;
    /**
     * Whether a row of a kind stands under a key (#1549): drafted, else read — a key whose row a draft deletes stands
     * free, so a row built under it again takes it back.
     *
     * @param slot - The kind's slot
     * @param key - The key's text
     */
    stands(slot: string, key: string): boolean;
    /**
     * The rows a gesture moves under the keys their fields build once it writes them (#1549): each row it finds held —
     * never one it makes — whose kind builds its key from its row, where the key its row builds changes, to another than
     * the one it stands under — a row whose fields an app wrote apart from its key, edited back to build it, stays (#1581).
     *
     * @param edits - The gesture's edits
     * @returns Each row it moves, and the key it moves under
     */
    moves(edits: readonly SchematicEdit[]): SchematicMove[];
    /**
     * Whether a kind builds a new row's key from its row: its `key` (#1549).
     *
     * @param slot - The kind's slot
     */
    builds(slot: string): boolean;
    /**
     * Why a kind adds no row (#1549): its keys are of a type the form can't type, and it builds none.
     *
     * @param slot - The kind's slot
     * @returns The key type's name; `undefined` for a kind that keys the rows it adds
     */
    untyped(slot: string): string | undefined;
    /**
     * Whether the viewer types a kind's new rows' keys (#1549): it makes none of its own — keyed by neither String nor
     * Integer, and building none — and the form types its key type. A new row waits under a placeholder until it is typed.
     *
     * @param slot - The kind's slot
     */
    keysTyped(slot: string): boolean;
}

/** A kind of any sort, as the payload carries it. */
type AnyKind = SchematicValue["items"][number] | SchematicValue["zones"][number] | SchematicValue["links"][number] | SchematicValue["nets"][number];

/** An Option's value, or `undefined`. */
function someOf<T>(value: option<T>): T | undefined {
    return value.type === "some" ? value.value : undefined;
}

/** Every kind of the payload, in the Schematic's order of its sorts: items', zones', links' and nets'. */
function kindsOf(value: Pick<SchematicValue, "items" | "zones" | "links" | "nets">): readonly AnyKind[] {
    return [...value.items, ...value.zones, ...value.links, ...value.nets];
}

/** A kind of the payload, by its slot; `undefined` for none — a details record's key among them. */
function kindOf(value: Pick<SchematicValue, "items" | "zones" | "links" | "nets">, slot: string): AnyKind | undefined {
    return kindsOf(value).find((kind) => stringEqual(kind.key, slot));
}

/**
 * The function a kind builds a new row's key from its row with (#1549): its `key`.
 *
 * @param kind - The kind
 * @returns It; `undefined` for a kind that builds none — a zone's among them
 */
function builderOf(kind: AnyKind | undefined): ((row: Uint8Array) => string) | undefined {
    return kind === undefined || !("rowKey" in kind) ? undefined : someOf(kind.rowKey);
}

/** Whether a kind's new rows wait under a placeholder for the viewer to type their keys (#1549): it makes none of its own. */
function placeholdersOf(kind: AnyKind): boolean {
    return !kindKeys(kind.keyType).text && kind.keyType.type !== "Integer" && builderOf(kind) === undefined;
}

/** A record a change names, as a row is found in it: its row type, its read by key, and its keys — a details record's its kind's. */
interface RecordSide {
    readonly rowType: EastTypeValue;
    readonly entries: ScheduleEditingRecord["entries"];
    readonly keys: KindKeys;
}

/** A row as a gesture finds it: its bytes, none — never held, or deleted by a draft — or its read in flight. */
type RowFound = { readonly state: "held"; readonly row: Uint8Array } | { readonly state: "absent" } | { readonly state: "reading" };

const ABSENT_ROW: RowFound = { state: "absent" };
const READING_ROW: RowFound = { state: "reading" };

/** Every row ready: what a placeholder's details row is, its own row holding Save. */
const READY: Readiness = variant("ready", null);

/** No key a gesture has made. */
const NO_MINTED: ReadonlySet<string> = new Set<string>();

/**
 * The Schematic's sessions over its records, and their drafts (see the module
 * docs).
 *
 * @param value - The payload
 * @param storageKey - The Schematic's key: its sessions and their history are kept under it
 * @param recordSlices - The slice's parts over the kinds read through their sources: each Save notice counts what leaves its own
 * @param held - Each kind's rows its read holds: the keys a new row's key is minted unique among
 * @param areas - The kinds read by area, by slot: never read whole, nor their narrowing complete
 * @param windows - The rows each kind read by area holds in its window, at the revision they were read at
 * @param words - What the editing says of a new row's key
 * @param paged - A row of a kind read by area the paged Backlog's pages read, by the kind's slot and the row's key, and the
 *   revision they read it at (#1393): asked as a gesture reads it, for a row the window does not hold
 * @param retained - Whether what the canvas draws is retained (#1398, CL8): no record takes an edit while it is
 * @returns The editing
 */
export function useSchematicEditing(value: SchematicValue, storageKey: string, recordSlices: readonly ValueTypeOf<RecordSliceBindType>[],
    held: SchematicHeldRows, areas: ReadonlySet<string>, windows: SchematicWindowRows, words: SchematicKeyWords,
    paged?: (slot: string, key: string) => { readonly revision: string; readonly row: Uint8Array } | undefined, retained = false): SchematicEditing {
    const kinds = useMemo((): readonly AnyKind[] => kindsOf({ items: value.items, zones: value.zones, links: value.links, nets: value.nets }),
        [value.items, value.zones, value.links, value.nets]);
    // The words as they stand when the history's check is made.
    const wordsNow = useRef(words);
    wordsNow.current = words;
    // Each kind bound with its patch door, and each one's details so bound, in the Schematic's order of its sorts — none
    // while the Schematic is read only — each with its form: a changed row's number outside its field's bounds holds Save
    // as the app's check does (#1585).
    const records = useMemo((): ScheduleEditingRecord[] => {
        if (value.readOnly) return [];
        const out: ScheduleEditingRecord[] = [];
        for (const kind of kinds) {
            const keys = kindKeys(kind.keyType);
            // A kind whose new rows wait under a placeholder (#1549): the app's check is asked of the rows under keys alone —
            // it reads each key back at the kind's key type — and a row under a placeholder waits on its key, its details
            // row ready, its own row holding Save.
            const waiting = (ready: ScheduleEditingRecord["ready"], verdict: () => Readiness): ScheduleEditingRecord["ready"] => (!placeholdersOf(kind) ? ready
                : some((batch: { id: string; entry: Uint8Array }[]): Readiness[] => {
                    const verdicts = batch.map(({ id }): Readiness => (keys.isKey(id) ? READY : verdict()));
                    const app = ready === undefined ? undefined : someOf(ready);
                    const rest = batch.flatMap((entry, i) => (keys.isKey(entry.id) ? [{ entry, i }] : []));
                    if (app !== undefined && rest.length > 0) app(rest.map(({ entry }) => entry)).forEach((said, n) => { verdicts[rest[n]!.i] = said; });
                    return verdicts;
                }));
            if (kind.editable && kind.editing.type === "some") {
                const ready = waiting(kind.ready, () => variant("incomplete", [{ field: "", message: wordsNow.current.placeholder({ name: kind.name }) }]));
                out.push({ key: kind.key, name: kind.name, editing: kind.editing.value, entries: kind.entries, ready, fields: kind.fields });
            }
            const details = someOf(kind.details);
            if (details !== undefined && details.editable && details.editing.type === "some") {
                out.push({
                    key: detailsKey(kind.key), name: `${kind.name} details`, editing: details.editing.value, entries: details.entries,
                    ready: waiting(details.ready, () => READY), fields: details.fields,
                });
            }
        }
        return out;
    }, [kinds, value.readOnly]);
    // Each record a change names, by its key in the history — a kind's own and its details' — as a row is found in it.
    const sides = useMemo(() => {
        const out = new Map<string, RecordSide>();
        for (const kind of kinds) {
            const keys = kindKeys(kind.keyType);
            out.set(kind.key, { rowType: kind.rowType, entries: kind.entries, keys });
            const details = someOf(kind.details);
            if (details !== undefined) out.set(detailsKey(kind.key), { rowType: details.rowType, entries: details.entries, keys });
        }
        return out;
    }, [kinds]);
    // The windows of the kinds read by area as they stand when a gesture or a Save reads them, and the Backlog's pages.
    const windowsNow = useRef(windows);
    useLayoutEffect(() => { windowsNow.current = windows; }, [windows]);
    const pagedNow = useRef(paged);
    useLayoutEffect(() => { pagedNow.current = paged; }, [paged]);
    // A kind read through its source: the rows its source's read holds, kept at the revision they were read at — a
    // gesture's original, and what a Save confirms its entries by. A kind read by area: the rows its window holds,
    // while they are at the record's revision; any other row is read by its key (#1393).
    const reads = useMemo((): Record<string, ScheduleRowRead> => {
        const out: Record<string, ScheduleRowRead> = {};
        for (const kind of kinds) {
            if (!kind.editable || kind.entries.type !== "some") continue;
            const entries = kind.entries.value;
            if (areas.has(kind.key)) {
                out[kind.key] = (key) => {
                    const at = entries.revision();
                    if (at.type !== "some") return undefined;
                    const window = windowsNow.current.get(kind.key);
                    const inWindow = window === undefined || !stringEqual(window.revision, at.value) ? undefined : heldInWindow(some(window.rows), key);
                    if (inWindow !== undefined) return inWindow;
                    // A row the window doesn't hold, a page of the Backlog read at the revision: a drop placing it (#1393).
                    const page = pagedNow.current?.(kind.key, key);
                    return page === undefined || !stringEqual(page.revision, at.value) ? undefined : some(some(page.row));
                };
                continue;
            }
            const rows = keptAtRevision<ReadonlyMap<string, { readonly row: Uint8Array }>>(kind.entries, () => kind.rows());
            out[kind.key] = (key) => heldInWindow(rows(), key);
        }
        return out;
    }, [kinds, areas]);
    const schedule = useScheduleEditing({ kinds: NO_KINDS, records, reads, storageKey, joined: NO_JOINED, recordSlices });

    // Each draft decoded once: a session keeps an entry's version the same object until a gesture replaces it.
    const decoded = useRef(new WeakMap<EntryVersion<ScheduleEntryRef>, DraftedRow<unknown>>());
    const draftsNow = schedule.drafts;
    const drafts = useMemo((): SchematicDrafts => {
        const sort = <R,>(sorted: readonly {
            readonly key: string; readonly rowType: EastTypeValue; readonly keyType: EastTypeValue; readonly read: (bytes: Uint8Array, key: string) => R;
        }[]): SortDrafts<R> => {
            const out = new Map<string, Map<string, DraftedRow<R> | undefined>>();
            for (const kind of sorted) {
                const ids = schedule.draftsOf(kind.key);
                if (ids.size === 0) continue;
                const session = schedule.sessions.find((part) => stringEqual(part.kind, kind.key))?.session;
                const codec = rowCodec(kind.rowType);
                // A row under a placeholder is read as keyed by its key type's default, its key still to be typed (#1549).
                const keys = kindKeys(kind.keyType);
                const rows = new Map<string, DraftedRow<R> | undefined>();
                for (const id of ids.keys()) {
                    const entry = session?.entries.get(id);
                    const row = draftedRow(entry);
                    if (entry === undefined || row === undefined) { rows.set(id, undefined); continue; }
                    let drafted = decoded.current.get(entry) as DraftedRow<R> | undefined;
                    if (drafted === undefined) {
                        // A row its session found absent before the gesture that wrote it is new; any other began as the row its
                        // record held then.
                        const began = draftedRow(session?.originals.get(id))?.row;
                        drafted = {
                            roles: kind.read(codec.encode(row.row), keys.readKey(id)), created: began === undefined,
                            began: began === undefined ? undefined : kind.read(codec.encode(began), keys.readKey(id)),
                        };
                        decoded.current.set(entry, drafted);
                    }
                    rows.set(id, drafted);
                }
                out.set(kind.key, rows);
            }
            return out;
        };
        return { items: sort(value.items), zones: sort(value.zones), links: sort(value.links), nets: sort(value.nets) };
        // The drafts move with every gesture: their bytes say when.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftsNow, value.items, value.zones, value.links, value.nets]);

    // Stable to the canvas: each runs the latest render's.
    const latest = useRef({ value, schedule, held, retained, reads, sides });
    latest.current = { value, schedule, held, retained, reads, sides };
    // Retained, no record takes an edit: every route asks it, and `record` refuses one (#1398, CL8).
    const scheduleAvailable = schedule.available;
    const available = useCallback((slot: string): boolean => !retained && scheduleAvailable(slot), [retained, scheduleAvailable]);
    const editedRecords = useMemo(() => new Set(records.map((record) => record.key)), [records]);
    const edited = useCallback((record: string): boolean => editedRecords.has(record), [editedRecords]);
    // A row as a gesture finds it: drafted, else as its record holds it — its read, else by its key.
    const rowNow = useCallback((record: string, id: string): RowFound => {
        const { schedule: editing, reads: own, sides: recorded } = latest.current;
        const side = recorded.get(record);
        if (side === undefined) return ABSENT_ROW;
        const codec = rowCodec(side.rowType);
        const entry = editing.sessions.find((part) => stringEqual(part.kind, record))?.session.entries.get(id);
        if (entry !== undefined) {
            const row = draftedRow(entry);
            return row === undefined ? ABSENT_ROW : { state: "held", row: codec.encode(row.row) };
        }
        // A placeholder names no row a record holds (#1549): never sought.
        if (!side.keys.isKey(id)) return ABSENT_ROW;
        if (side.entries.type !== "some") {
            const stored = editing.held(record, id);
            return stored === undefined ? ABSENT_ROW : { state: "held", row: codec.encode(stored) };
        }
        let read: option<option<Uint8Array>>;
        try {
            read = own[record]?.(id) ?? side.entries.value.entry(id);
        } catch (err) {
            console.error(`[Schematic] ${record}'s row ${id} could not be read:`, err);
            return READING_ROW;
        }
        if (read.type !== "some") return READING_ROW;
        return read.value.type === "some" ? { state: "held", row: read.value.value } : ABSENT_ROW;
    }, []);
    // A gesture's edits as the shared editing records them, each row through its kind's own functions; `undefined` where
    // a kind refuses one, or a row a move takes is gone or still read.
    const changesOf = useCallback((edits: readonly SchematicEdit[]): ScheduleChange[] | undefined => {
        const { value: payload } = latest.current;
        const of = <K extends { readonly key: string }>(sorted: readonly K[], slot: string): K | undefined => sorted.find((kind) => stringEqual(kind.key, slot));
        const changes: ScheduleChange[] = [];
        for (const edit of edits) {
            const slot = edit.ref.kind;
            const id = edit.ref.key;
            switch (edit.op) {
                case "remove":
                    changes.push({ kind: slot, id, remove: true });
                    break;
                case "place": {
                    const kind = of(payload.items, slot);
                    if (kind === undefined) return undefined;
                    changes.push({ kind: slot, id, rewrite: (row) => someOf(kind.write(row, edit.at)) });
                    break;
                }
                case "ends": {
                    const kind = of(payload.links, slot);
                    if (kind === undefined) return undefined;
                    changes.push({ kind: slot, id, rewrite: (row) => someOf(kind.write(row, edit.ends)) });
                    break;
                }
                case "sides": {
                    const kind = of(payload.nets, slot);
                    if (kind === undefined) return undefined;
                    changes.push({ kind: slot, id, rewrite: (row) => someOf(kind.write(row, edit.sides)) });
                    break;
                }
                case "link": {
                    // A row the app's `values` fail to make (#1526), as one its kind refuses, records nothing.
                    const kind = of(payload.links, slot);
                    const row = kind === undefined ? undefined : madeFromValues("Schematic", `a new ${kind.name}`, () => kind.create(edit.ends, edit.values));
                    if (row?.type !== "some") return undefined;
                    changes.push({ kind: slot, id, row: row.value, created: true });
                    break;
                }
                case "net": {
                    const kind = of(payload.nets, slot);
                    const row = kind === undefined ? undefined : madeFromValues("Schematic", `a new ${kind.name}`, () => kind.create(edit.sides, edit.values));
                    if (row?.type !== "some") return undefined;
                    changes.push({ kind: slot, id, row: row.value, created: true });
                    break;
                }
                case "item": {
                    const row = of(payload.items, slot)?.create(edit.at, edit.values);
                    if (row === undefined || row.type !== "some") return undefined;
                    changes.push({ kind: slot, id, row: row.value, created: true });
                    break;
                }
                case "retype": {
                    // A template's values over the ends or the sides the row holds as the gesture finds it: they and its key stay.
                    const link = of(payload.links, slot);
                    const net = link === undefined ? of(payload.nets, slot) : undefined;
                    if (link !== undefined) {
                        const key = kindKeys(link.keyType).readKey(id);
                        changes.push({ kind: slot, id, rewrite: (row) => {
                            const roles = link.read(row, key);
                            return someOf(link.create({ from: roles.from, to: roles.to }, some(edit.values)));
                        } });
                    } else if (net !== undefined) {
                        const key = kindKeys(net.keyType).readKey(id);
                        changes.push({ kind: slot, id, rewrite: (row) => {
                            const roles = net.read(row, key);
                            return someOf(net.create({ sources: roles.sources, destinations: roles.destinations }, some(edit.values)));
                        } });
                    } else {
                        return undefined;
                    }
                    break;
                }
                case "set": {
                    // A field of the row, or of its details row (#1391), through its record's own setter.
                    const kind = of(kindsOf(payload), slot);
                    const side = edit.details === true ? (kind === undefined ? undefined : someOf(kind.details)) : kind;
                    if (side === undefined) return undefined;
                    changes.push({ kind: edit.details === true ? detailsKey(slot) : slot, id, rewrite: (row) => someOf(side.set(row, [...edit.sets])) });
                    break;
                }
                case "row":
                    // The row a kind's own Details hands back (#1391), whole.
                    changes.push({ kind: edit.details === true ? detailsKey(slot) : slot, id, row: edit.row });
                    break;
                case "move": {
                    // The row, or its details row, under its new key as the gesture finds it, and gone from its own (#1549): a
                    // details row the record holds none of moves nothing; a row gone, or still read, refuses the gesture. In a
                    // swap or a shift (#1581) it replaces the row moving off its new key, never a new one, and its own key,
                    // which another row moves under, stays.
                    const record = edit.details === true ? detailsKey(slot) : slot;
                    const found = rowNow(record, id);
                    if (found.state === "reading") return undefined;
                    if (found.state === "absent") {
                        if (edit.details === true) break;
                        return undefined;
                    }
                    changes.push({ kind: record, id: edit.to, row: found.row, ...(edit.replaces === true ? {} : { created: true as const }) });
                    if (edit.refilled !== true) changes.push({ kind: record, id, remove: true });
                    break;
                }
            }
        }
        return changes;
    }, [rowNow]);
    const record = useCallback((edits: readonly SchematicEdit[], origin: Origin, label: string): boolean => {
        const { schedule: editing, retained: standingIn } = latest.current;
        if (standingIn) return false;
        const changes = changesOf(edits);
        return changes !== undefined && changes.length > 0 && editing.record(changes, origin, label);
    }, [changesOf]);
    const taken = useCallback((slot: string, key: string): boolean => {
        const { schedule: editing, held: read } = latest.current;
        const session = editing.sessions.find((part) => stringEqual(part.kind, slot))?.session;
        return session?.entries.has(key) === true || read.get(slot)?.has(key) === true;
    }, []);
    const stands = useCallback((slot: string, key: string): boolean => {
        const { schedule: editing, held: read } = latest.current;
        const entry = editing.sessions.find((part) => stringEqual(part.kind, slot))?.session.entries.get(key);
        if (entry !== undefined) return draftedRow(entry) !== undefined;
        return read.get(slot)?.has(key) === true;
    }, []);
    const newKey = useCallback((made: SchematicEdit, minted: ReadonlySet<string> = NO_MINTED): SchematicNewKey | undefined => {
        const { value: payload, schedule: editing } = latest.current;
        const slot = made.ref.kind;
        const kind = kindOf(payload, slot);
        if (kind === undefined) return undefined;
        const keys = kindKeys(kind.keyType);
        const holds = (key: string): boolean => minted.has(key) || taken(slot, key);
        // Built from the row the edit makes: refused where a row stands under it.
        const build = builderOf(kind);
        if (build !== undefined) {
            const change = changesOf([made])?.[0];
            const row = change !== undefined && "row" in change ? change.row : undefined;
            if (row === undefined) return undefined;
            let key: string;
            try {
                key = build(row);
            } catch (err) {
                console.error(`[Schematic] ${kind.name}'s key could not be built from a new row:`, err);
                return undefined;
            }
            return minted.has(key) || stands(slot, key) ? { taken: key } : { key };
        }
        if (keys.text) return { key: mintKey(holds) };
        if (kind.keyType.type === "Integer") {
            const key = editing.mint(slot, "", minted);
            return key === undefined ? undefined : { key };
        }
        // A placeholder: a text minted that no key prints as, until the viewer types its key.
        if (keys.typed) return { key: mintKey((key) => keys.isKey(key) || holds(key)) };
        return { untyped: kind.keyType.type };
    }, [changesOf, taken, stands]);
    const moves = useCallback((edits: readonly SchematicEdit[]): SchematicMove[] => {
        const { value: payload } = latest.current;
        const changes = changesOf(edits);
        // A gesture touching no kind that builds its keys moves no row: its edits are never composed.
        if (changes === undefined || !changes.some((change) => builderOf(kindOf(payload, change.kind)) !== undefined)) return [];
        // Each row the gesture touches as it leaves it, the edits composed in order over the row as it finds it.
        const at = (record: string, key: string): string => `${record}\u0000${key}`;
        const found = (record: string, key: string): Uint8Array | undefined => {
            const got = rowNow(record, key);
            return got.state === "held" ? got.row : undefined;
        };
        const now = new Map<string, Uint8Array | undefined>();
        const made = new Set<string>();
        const touched: { record: string; key: string }[] = [];
        const seen = new Set<string>();
        for (const change of changes) {
            const id = at(change.kind, change.id);
            if (!seen.has(id)) { seen.add(id); touched.push({ record: change.kind, key: change.id }); }
            const was = now.has(id) ? now.get(id) : found(change.kind, change.id);
            if ("remove" in change) now.set(id, undefined);
            else if ("row" in change) {
                now.set(id, change.row);
                if (change.created === true) made.add(id);
            } else if ("rewrite" in change && was !== undefined) {
                try {
                    now.set(id, change.rewrite(was) ?? was);
                } catch {
                    now.set(id, was);
                }
            }
        }
        const out: SchematicMove[] = [];
        for (const { record, key } of touched) {
            const id = at(record, key);
            const kind = kindOf(payload, record);
            const build = builderOf(kind);
            const was = found(record, key);
            const after = now.get(id);
            if (made.has(id) || build === undefined || was === undefined || after === undefined) continue;
            try {
                const to = build(after);
                if (!stringEqual(build(was), to) && !stringEqual(key, to)) out.push({ ref: { kind: record, key }, to });
            } catch (err) {
                console.error(`[Schematic] ${kind?.name ?? record}'s key could not be built from ${key}'s row:`, err);
            }
        }
        return out;
    }, [changesOf, rowNow]);
    const builds = useCallback((slot: string): boolean => builderOf(kindOf(latest.current.value, slot)) !== undefined, []);
    const untyped = useCallback((slot: string): string | undefined => {
        const kind = kindOf(latest.current.value, slot);
        if (kind === undefined || builderOf(kind) !== undefined) return undefined;
        const keys = kindKeys(kind.keyType);
        return keys.text || kind.keyType.type === "Integer" || keys.typed ? undefined : kind.keyType.type;
    }, []);
    const keysTyped = useCallback((slot: string): boolean => {
        const kind = kindOf(latest.current.value, slot);
        return kind !== undefined && placeholdersOf(kind) && kindKeys(kind.keyType).typed;
    }, []);

    return useMemo(() => ({
        schedule, history: schedule.history, edits: records.length > 0, drafts, version: schedule.version, available, record, edited, newKey, taken,
        stands, moves, builds, untyped, keysTyped,
    }), [schedule, records.length, drafts, available, record, edited, newKey, taken, stands, moves, builds, untyped, keysTyped]);
}
