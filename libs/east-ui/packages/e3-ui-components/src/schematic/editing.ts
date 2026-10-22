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
 *   a row it does not hold is read by its key. Drafts of rows the narrowing
 *   hides stay in their sessions, and Save sends them (SC23).
 * - **Its writes.** A gesture's edits (`edits.ts`) go through the kinds' own
 *   functions: an existing row is rewritten from the row as its session finds
 *   it — drafted, else as the record holds it — through its kind's `write`, so
 *   only its roles' fields move (SC2); a new row is its kind's `create`, its
 *   key minted unique among every key the Schematic has read and drafted
 *   (`mintKey`, SC7); a deleted one is removed. A gesture any of whose rows its
 *   kind refuses records nothing.
 * - **Its drafts.** Each draft is decoded once: its roles read through its
 *   kind's `read`, kept while its session keeps the entry's version — what the
 *   frame draws over the stored rows (`drafted.ts`).
 *
 * A Schematic read only (`readOnly`) has no session, nor has a kind bound read
 * only (SC14).
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { StringType, equalFor, type ValueTypeOf, type option } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import type { EditHistory, EntryVersion, Origin } from "@elaraai/east-ui-components";
import {
    useScheduleEditing,
    type ScheduleChange, type ScheduleEditing, type ScheduleEditingKind, type ScheduleEditingRecord, type ScheduleEntryRef, type ScheduleRowRead,
} from "../shared/schedule/editing.js";
import { draftedRow, heldInWindow, keptAtRevision, mintKey, rowCodec } from "../shared/schedule/records.js";
import type { SchematicHeldRows, SchematicValue } from "./data.js";
import type { DraftedRow, SchematicDrafts, SortDrafts } from "./drafted.js";
import type { SchematicEdit } from "./edits.js";

const stringEqual = equalFor(StringType);

/** No event kind: the Schematic writes its kinds a whole row at a time, as records. */
const NO_KINDS: readonly ScheduleEditingKind[] = [];

/** No session made elsewhere joins the Schematic's history. */
const NO_JOINED: Parameters<typeof useScheduleEditing>[0]["joined"] = [];

/**
 * What a change names a kind's details record by: never a kind's slot, which
 * holds no NUL.
 *
 * @param slot - The kind's slot
 * @returns The details record's key in the history
 */
export function detailsKey(slot: string): string {
    return `${slot}\u0000details`;
}

/**
 * The slot of the kind a record of the history is: the kind's own, or the kind
 * whose details it is ({@link detailsKey}).
 *
 * @param key - The record's key in the history
 * @returns The kind's slot
 */
export function recordSlot(key: string): string {
    const at = key.indexOf("\u0000");
    return at < 0 ? key : key.slice(0, at);
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
     * Records one gesture's edits as one step of the history.
     *
     * @param edits - The rows it changes, and how
     * @param origin - The gesture
     * @param label - Its label in the history
     * @returns Whether anything was recorded: nothing is when a kind refuses a row, or a row's read is in flight
     */
    record(edits: readonly SchematicEdit[], origin: Origin, label: string): boolean;
    /**
     * A new row's key: unique among every key the Schematic has read and drafted of the kind, and those given.
     *
     * @param slot - The kind's slot
     * @param minted - The keys the gesture has minted already
     * @returns The key
     */
    mint(slot: string, minted: ReadonlySet<string>): string;
}

/** A kind of any sort, as the payload carries it. */
type AnyKind = SchematicValue["items"][number] | SchematicValue["zones"][number] | SchematicValue["links"][number] | SchematicValue["nets"][number];

/** An Option's value, or `undefined`. */
function someOf<T>(value: option<T>): T | undefined {
    return value.type === "some" ? value.value : undefined;
}

/**
 * The Schematic's sessions over its records, and their drafts (see the module
 * docs).
 *
 * @param value - The payload
 * @param storageKey - The Schematic's key: its sessions and their history are kept under it
 * @param recordSlices - The slice's parts over the kinds read through their sources: each Save notice counts what leaves its own
 * @param held - Each kind's rows its read holds: the keys a new row's key is minted unique among
 * @returns The editing
 */
export function useSchematicEditing(value: SchematicValue, storageKey: string, recordSlices: readonly ValueTypeOf<RecordSliceBindType>[],
    held: SchematicHeldRows): SchematicEditing {
    const kinds = useMemo((): readonly AnyKind[] => [...value.items, ...value.zones, ...value.links, ...value.nets],
        [value.items, value.zones, value.links, value.nets]);
    // Each kind bound with its patch door, and each one's details so bound, in the Schematic's order of its sorts — none
    // while the Schematic is read only.
    const records = useMemo((): ScheduleEditingRecord[] => {
        if (value.readOnly) return [];
        const out: ScheduleEditingRecord[] = [];
        for (const kind of kinds) {
            if (kind.editable && kind.editing.type === "some") {
                out.push({ key: kind.key, name: kind.name, editing: kind.editing.value, entries: kind.entries, ready: kind.ready });
            }
            const details = someOf(kind.details);
            if (details !== undefined && details.editable && details.editing.type === "some") {
                out.push({ key: detailsKey(kind.key), name: `${kind.name} details`, editing: details.editing.value, entries: details.entries, ready: details.ready });
            }
        }
        return out;
    }, [kinds, value.readOnly]);
    // A kind read through its source: the rows its source's read holds, kept at the revision they were read at — a
    // gesture's original, and what a Save confirms its entries by.
    const reads = useMemo((): Record<string, ScheduleRowRead> => {
        const out: Record<string, ScheduleRowRead> = {};
        for (const kind of kinds) {
            if (!kind.editable || kind.entries.type !== "some") continue;
            const rows = keptAtRevision<ReadonlyMap<string, { readonly row: Uint8Array }>>(kind.entries, () => kind.rows());
            out[kind.key] = (key) => heldInWindow(rows(), key);
        }
        return out;
    }, [kinds]);
    const schedule = useScheduleEditing({ kinds: NO_KINDS, records, reads, applyMode: "batch", storageKey, joined: NO_JOINED, recordSlices });

    // Each draft decoded once: a session keeps an entry's version the same object until a gesture replaces it.
    const decoded = useRef(new WeakMap<EntryVersion<ScheduleEntryRef>, DraftedRow<unknown>>());
    const draftsNow = schedule.drafts;
    const drafts = useMemo((): SchematicDrafts => {
        const sort = <R,>(sorted: readonly { readonly key: string; readonly rowType: SchematicValue["items"][number]["rowType"]; readonly read: (bytes: Uint8Array, key: string) => R }[]): SortDrafts<R> => {
            const out = new Map<string, Map<string, DraftedRow<R> | undefined>>();
            for (const kind of sorted) {
                const ids = schedule.draftsOf(kind.key);
                if (ids.size === 0) continue;
                const session = schedule.sessions.find((part) => stringEqual(part.kind, kind.key))?.session;
                const codec = rowCodec(kind.rowType);
                const rows = new Map<string, DraftedRow<R> | undefined>();
                for (const id of ids.keys()) {
                    const entry = session?.entries.get(id);
                    const row = draftedRow(entry);
                    if (entry === undefined || row === undefined) { rows.set(id, undefined); continue; }
                    let drafted = decoded.current.get(entry) as DraftedRow<R> | undefined;
                    if (drafted === undefined) {
                        // A row its session found absent before the gesture that wrote it is new.
                        drafted = { roles: kind.read(codec.encode(row.row), id), created: session?.originals.get(id)?.draft === undefined };
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
    const latest = useRef({ value, schedule, held });
    latest.current = { value, schedule, held };
    const record = useCallback((edits: readonly SchematicEdit[], origin: Origin, label: string): boolean => {
        const { value: payload, schedule: editing } = latest.current;
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
                    if (kind === undefined) return false;
                    changes.push({ kind: slot, id, rewrite: (row) => someOf(kind.write(row, edit.at)) });
                    break;
                }
                case "ends": {
                    const kind = of(payload.links, slot);
                    if (kind === undefined) return false;
                    changes.push({ kind: slot, id, rewrite: (row) => someOf(kind.write(row, edit.ends)) });
                    break;
                }
                case "sides": {
                    const kind = of(payload.nets, slot);
                    if (kind === undefined) return false;
                    changes.push({ kind: slot, id, rewrite: (row) => someOf(kind.write(row, edit.sides)) });
                    break;
                }
                case "link": {
                    const row = of(payload.links, slot)?.create(edit.ends, edit.values);
                    if (row === undefined || row.type !== "some") return false;
                    changes.push({ kind: slot, id, row: row.value, created: true });
                    break;
                }
                case "net": {
                    const row = of(payload.nets, slot)?.create(edit.sides, edit.values);
                    if (row === undefined || row.type !== "some") return false;
                    changes.push({ kind: slot, id, row: row.value, created: true });
                    break;
                }
            }
        }
        return changes.length > 0 && editing.record(changes, origin, label);
    }, []);
    const mint = useCallback((slot: string, minted: ReadonlySet<string>): string => {
        const { schedule: editing, held: read } = latest.current;
        const session = editing.sessions.find((part) => stringEqual(part.kind, slot))?.session;
        const rows = read.get(slot);
        return mintKey((key) => minted.has(key) || session?.entries.has(key) === true || rows?.has(key) === true);
    }, []);

    return useMemo(() => ({
        schedule, history: schedule.history, edits: records.length > 0, drafts, version: schedule.version, record, mint,
    }), [schedule, records.length, drafts, record, mint]);
}
