/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's editing (#1503, `Flowchart Records Spec.md` R8–R13): one
 * history over a session a record — the states, the transitions, the lanes
 * and the decisions, each bound with its patch door — through the shared
 * Schedule editing (`shared/schedule/editing.ts`' `useScheduleEditing`), as
 * the Schematic's is (`schematic/editing.ts`). A gesture is one step across
 * the records it changes; Save sends each record's changes as a request of its
 * own through its patch door, and a refusal keeps that record's drafts and
 * leaves the others' commits standing (R12).
 *
 * - **Its reads.** A kind read whole is a session over its record's snapshot.
 *   A kind read through its source of the rail is read by key through its
 *   `entries`: what its source's read holds, kept at the revision it was read
 *   at (`keptAtRevision`), is a gesture's original and a Save's
 *   confirmation, and a row it does not hold is read by its key. Drafts of
 *   rows the narrowing hides stay in their sessions by their original keys,
 *   and Save sends them (R11).
 * - **Its writes.** A gesture's edits (`edits.ts`) go through the kinds' own
 *   functions: an existing row is rewritten from the row as its session finds
 *   it — drafted, else as the record holds it — through its kind's `write`, so
 *   only its roles' fields move (R8); a new row is its kind's `create`; a
 *   transition dropped a card is its kind's `create` over the ends its row
 *   holds, so they and its key stay; a decision's queue loses a deleted
 *   state's key through its kind's `unqueue`, and takes a state's new key in
 *   its old one's place through its `requeue`; a field of the form through its
 *   kind's `set`; the row a kind's own Details hands back, whole. A gesture any
 *   of whose rows its kind refuses records nothing.
 * - **A new key e3 holds already (R9, D3).** A kind read through its source
 *   under `"hide"` knows only the keys its narrowing keeps, so its session's
 *   check asks e3 for each new row's key by key through the kind's source —
 *   every such key in one request (`recordSliceRows`), each read back at the
 *   kind's key type (#1549), inside the history's tracked check — and a key
 *   e3 holds already is an `invalid` issue holding Save off, `incomplete`
 *   while the answer is read; the app's own `ready` is asked beside it. A key
 *   the Flowchart holds already is refused as it is typed (`edits.ts`).
 * - **A new row's key (#1549)** is its kind's to make (`newKey`): built from
 *   the row by the kind's `key`; else, keyed by String, the text the gesture
 *   makes up; by Integer, one past the largest the record, the drafts and the
 *   gesture hold — a kind read through its source asking its record for its
 *   largest; by any type the form types, a placeholder — a text no key prints
 *   as — which holds Save, `incomplete` at the row's key field, until the
 *   viewer types its key; and by any other, none: the kind adds no row
 *   (`untyped`). A row whose kind builds its key from its fields moves under
 *   the key a gesture's edit of them builds (`moves`).
 * - **A number its field's bounds don't hold (#1585).** Each kind's form goes
 *   with its record (`fields`): a changed row whose number is under its least
 *   or over its most holds Save, as the app's check does, and Issues names it.
 * - **Its drafts.** Each draft is decoded once: its roles read through its
 *   kind's `read`, kept while its session keeps the entry's version — what the
 *   frame draws over the stored rows (`drafted.ts`).
 * - **What a Save landed.** A kind read by key is confirmed as its rows land,
 *   while the frame is handed what was read only once every kind has: its
 *   session keeps what each Save landed (`drawsLanded`, `EditSession.landed`),
 *   each row decoded once, which the frame lays under the drafts over stored
 *   rows read before the Save (`drafted.ts`' `landedDrafts`) and lets go once
 *   they are read since (`shown`).
 * - **What stands in.** While what the canvas draws stands in for a new
 *   narrowing, it is retained: no record takes an edit — every route asks
 *   `available`, and `record` records nothing — until it lands. The history's
 *   Undo, Redo, Discard and Save stay live.
 *
 * A Flowchart read only (`readOnly`) has no session, nor has a kind bound read
 * only (R13).
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { StringType, equalFor, none, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import type { EditingReadinessType, RecordSliceBindType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined, type EditHistory, type EntryVersion, type LandedEntry, type Origin } from "@elaraai/east-ui-components";
import { recordSliceRows } from "@elaraai/east-ui-components/internal";
import {
    useScheduleEditing,
    type ScheduleChange, type ScheduleEditing, type ScheduleEditingKind, type ScheduleEditingRecord, type ScheduleEntryRef, type ScheduleKindSession,
    type ScheduleRowRead,
} from "../shared/schedule/editing.js";
import { kindKeys } from "../shared/schedule/kind-keys.js";
import { draftedRow, heldInWindow, keptAtRevision, madeFromValues, mintKey, rowCodec } from "../shared/schedule/records.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import { NONE_LANDED, NO_LANDED, type DraftedRow, type FlowchartDrafts, type FlowchartLanded, type KindDrafts, type KindLanded, type LandedRow } from "./drafted.js";
import type {
    FlowchartDecisionRoles, FlowchartLaneRoles, FlowchartStateRoles, FlowchartTransitionRoles, FlowchartValue,
} from "./model.js";
import { FLOWCHART_SORTS, type FlowchartHeld, type FlowchartSort } from "./read.js";

const stringEqual = equalFor(StringType);

/** No event kind: the Flowchart writes its kinds a whole row at a time, as records. */
const NO_KINDS: readonly ScheduleEditingKind[] = [];

/** No session made elsewhere joins the Flowchart's history. */
const NO_JOINED: Parameters<typeof useScheduleEditing>[0]["joined"] = [];

/** A state's write, decoded. */
export type FlowchartStateWrite = ValueTypeOf<typeof import("@elaraai/e3-ui/internal").Flowchart.Types.StateWrite>;
/** A transition's write, decoded. */
export type FlowchartTransitionWrite = ValueTypeOf<typeof import("@elaraai/e3-ui/internal").Flowchart.Types.TransitionWrite>;
/** A lane's write, decoded. */
export type FlowchartLaneWrite = ValueTypeOf<typeof import("@elaraai/e3-ui/internal").Flowchart.Types.LaneWrite>;
/** The fields an author's card or the form sets on a row, as a kind's `set` takes them. */
export type FlowchartFieldWrites = Parameters<FlowchartValue["states"]["set"]>[1];

/** A drafted row's readiness, as a kind's check gives it. */
type Readiness = ValueTypeOf<typeof EditingReadinessType>;

/**
 * One row a gesture changes, and how (R8): each through its kind's own
 * functions, as the module docs say.
 */
export type FlowchartEdit =
    | { readonly op: "createState"; readonly key: string; readonly write: FlowchartStateWrite; readonly values: option<Uint8Array> }
    | { readonly op: "writeState"; readonly key: string; readonly write: FlowchartStateWrite }
    | { readonly op: "createTransition"; readonly key: string; readonly write: FlowchartTransitionWrite; readonly values: option<Uint8Array> }
    | { readonly op: "writeTransition"; readonly key: string; readonly write: FlowchartTransitionWrite }
    /** A transition given a card's values, its ends and its key kept. */
    | { readonly op: "retypeTransition"; readonly key: string; readonly values: Uint8Array }
    | { readonly op: "createLane"; readonly key: string; readonly write: FlowchartLaneWrite; readonly values: option<Uint8Array> }
    | { readonly op: "writeLane"; readonly key: string; readonly write: FlowchartLaneWrite }
    /** A deleted state's key taken out of a decision's queue. */
    | { readonly op: "unqueue"; readonly key: string; readonly state: string }
    /** A state's key replaced in a decision's queue by the new key it moves to (#1549). */
    | { readonly op: "requeue"; readonly key: string; readonly from: string; readonly to: string }
    /** Fields no role writes: the form's, or an author's card's. */
    | { readonly op: "set"; readonly sort: FlowchartSort; readonly key: string; readonly sets: FlowchartFieldWrites }
    /** A row whole: the one a kind's own Details hands back. */
    | { readonly op: "row"; readonly sort: FlowchartSort; readonly key: string; readonly row: Uint8Array }
    /**
     * A new row under `key`, a copy of the row under `from` as its session finds it — a duplicate, or a new row under the
     * key the form gives it — its order written where given. In a swap or a shift (#1581) it `replaces` the row the
     * gesture moves off `key`, never a new one.
     */
    | { readonly op: "copy"; readonly sort: FlowchartSort; readonly key: string; readonly from: string; readonly order?: number | undefined; readonly replaces?: true }
    | { readonly op: "remove"; readonly sort: FlowchartSort; readonly key: string };

/** What the key check says, in the flowchart's words. */
export interface FlowchartKeyCheckWords {
    /** A new row's key e3 holds already — `A state is keyed "SCN" already`. */
    readonly held: (p: { sort: FlowchartSort; key: string }) => string;
    /** While e3 is asked for it — `Checking the key "SCN"`. */
    readonly checking: (p: { sort: FlowchartSort; key: string }) => string;
    /** A new row held under a placeholder, its key still to be typed (#1549) — `Type this lane's key: Save waits for it`. */
    readonly placeholder: (p: { sort: FlowchartSort }) => string;
}

/** A new row's key, as its kind makes it (#1549). */
export type FlowchartNewKey =
    /** Its key: built from its row, made up, one past the largest, or a placeholder until the viewer types its key. */
    | { readonly key: string }
    /** None: the key its row builds is held already, by the row of that key. */
    | { readonly taken: string }
    /** None: its kind's keys are of a type the form can't type — by the type's name — and its kind builds none. */
    | { readonly untyped: string };

/** A row a gesture moves under the key its fields build once the gesture writes them (#1549). */
export interface FlowchartMove {
    /** Its kind. */
    readonly sort: FlowchartSort;
    /** Its key. */
    readonly key: string;
    /** The key its row builds after the gesture. */
    readonly to: string;
}

/** The Flowchart's editing: its history, every kind's drafts, and how a gesture is recorded. */
export interface FlowchartEditing {
    /** The shared Schedule editing over the records: each one's session, and what each holds. */
    readonly schedule: ScheduleEditing;
    /** The one history over them. */
    readonly history: EditHistory<ScheduleEntryRef>;
    /** Whether any record is edited: a kind bound with its patch door, and the Flowchart not read only. */
    readonly edits: boolean;
    /** Every kind's drafts, each decoded once. */
    readonly drafts: FlowchartDrafts;
    /**
     * What each confirmed Save landed of the kinds read by key, as their sessions keep it (`EditSession.landed`), each row
     * decoded once: laid under the drafts over stored rows read before the Save (`drafted.ts`' `landedDrafts`).
     */
    readonly landed: FlowchartLanded;
    /** The history's version: it moves with every change of it or of its sessions. */
    readonly version: number;
    /**
     * Lets go of what Saves landed of a kind's rows, once the stored rows hold them as the record does now (`drafted.ts`'
     * `landedRead`).
     *
     * @param sort - The kind
     * @param keys - The rows' keys
     */
    shown(sort: FlowchartSort, keys: readonly string[]): void;
    /**
     * Whether the decisions queue states by their keys: a queue is given them — a state's Del takes its key out, and a
     * state moved to a new key takes it there.
     */
    readonly unqueues: boolean;
    /** Whether the lanes' order takes a whole number alone: an Integer field, whose write and create give none for another. */
    readonly wholeLaneOrders: boolean;
    /**
     * Whether a kind is edited at all: bound with its patch door, and the Flowchart not read only (R13).
     *
     * @param sort - The kind
     */
    editable(sort: FlowchartSort): boolean;
    /**
     * Whether a kind takes an edit now: its session takes one, and nothing the canvas draws is retained.
     *
     * @param sort - The kind
     */
    available(sort: FlowchartSort): boolean;
    /**
     * Records one gesture's edits as one step of the history.
     *
     * @param edits - The rows it changes, and how
     * @param origin - The gesture
     * @param label - Its label in the history
     * @returns Whether anything was recorded: nothing is when a kind refuses a row, a row's read is in flight, or what the
     *   canvas draws is retained
     */
    record(edits: readonly FlowchartEdit[], origin: Origin, label: string): boolean;
    /**
     * Whether the Flowchart holds a key of a kind already: read, or drafted — a new row's among them.
     *
     * @param sort - The kind
     * @param key - The key
     */
    taken(sort: FlowchartSort, key: string): boolean;
    /**
     * Whether a row of a kind stands under a key (#1549): drafted, else read — a key whose row a draft deletes stands
     * free, so a row built under it again takes it back.
     *
     * @param sort - The kind
     * @param key - The key
     */
    stands(sort: FlowchartSort, key: string): boolean;
    /**
     * A new transition's key: minted unique (`crypto.randomUUID()`) among every key the Flowchart has read and drafted
     * of the transitions, and those given — never drawn (R9).
     *
     * @param minted - The keys the gesture has minted already
     */
    mintTransition(minted: ReadonlySet<string>): string;
    /**
     * A new row's key, as its kind makes one (#1549; the module docs): built from the row the edit makes, by the
     * kind's `key`, refused where a row holds it; else, keyed by String, the text the gesture makes up; by Integer,
     * one past the largest; by a type the form types, the text made up as a placeholder; by any other, none.
     *
     * @param sort - The row's kind
     * @param made - The edit making the row, under any key: what the kind's `key` builds its key from
     * @param madeUp - The text the gesture makes up, unique by what it is told is taken: `lane-<n>`, `state-<n>`, a UUID
     * @param minted - The keys the gesture has made already
     * @returns The key, or why there is none; `undefined` while a kind read through its source asks its record for its
     *   largest, or where the kind makes no row of the edit
     */
    newKey(sort: FlowchartSort, made: FlowchartEdit, madeUp: (taken: (key: string) => boolean) => string, minted?: ReadonlySet<string>): FlowchartNewKey | undefined;
    /**
     * The rows a gesture moves under the keys their fields build once it writes them (#1549): each row it finds held —
     * never one it makes — whose kind builds its key from its row, where the key its row builds changes, to another than
     * the one it stands under — a row whose fields an app wrote apart from its key, edited back to build it, stays (#1581).
     *
     * @param edits - The gesture's edits
     * @returns Each row it moves, and the key it moves under
     */
    moves(edits: readonly FlowchartEdit[]): FlowchartMove[];
    /**
     * Whether a kind builds a new row's key from its row: its `key`, which a key field never edits (#1549).
     *
     * @param sort - The kind
     */
    builds(sort: FlowchartSort): boolean;
    /**
     * Why a kind adds no row (#1549): its keys are of a type the form can't type, and it builds none.
     *
     * @param sort - The kind
     * @returns The key type's name; `undefined` for a kind that keys the rows it adds
     */
    untyped(sort: FlowchartSort): string | undefined;
}

/** An Option's value, or `undefined`. */
function someOf<T>(value: option<T>): T | undefined {
    return value.type === "some" ? value.value : undefined;
}

/** A kind of any sort, as the payload carries it. */
type AnyKind = FlowchartValue["states"] | NonNullable<FlowchartValue["transitions"] extends option<infer T> ? T : never>
    | NonNullable<FlowchartValue["lanes"] extends option<infer T> ? T : never> | NonNullable<FlowchartValue["decisions"] extends option<infer T> ? T : never>;

/**
 * A kind of the payload, by its sort.
 *
 * @param value - The payload
 * @param sort - The kind
 * @returns It; `undefined` for a kind the Flowchart is not given
 */
export function kindOf(value: FlowchartValue, sort: FlowchartSort): AnyKind | undefined {
    switch (sort) {
        case "states": return value.states;
        case "transitions": return getSomeorUndefined(value.transitions);
        case "lanes": return getSomeorUndefined(value.lanes);
        case "decisions": return getSomeorUndefined(value.decisions);
    }
}

/** Every kind ready: what the check gives a batch with no app's check of its own. */
const READY: Readiness = variant("ready", null);

/** No key a gesture has made. */
const NO_MINTED: ReadonlySet<string> = new Set<string>();

/**
 * The function a kind builds a new row's key from its row with (#1549): its `key`.
 *
 * @param kind - The kind
 * @returns It; `undefined` for a kind that builds none — a decision's among them
 */
function builderOf(kind: AnyKind | undefined): ((row: Uint8Array) => string) | undefined {
    return kind === undefined || !("rowKey" in kind) ? undefined : getSomeorUndefined(kind.rowKey);
}

/**
 * A row as its session finds it: drafted, else as the read holds it.
 *
 * @param editing - The shared editing
 * @param held - Each kind's stored rows the read holds
 * @param kind - The row's kind
 * @param sort - Its sort
 * @param key - Its key
 * @returns Its bytes; `undefined` for a row its draft deletes, or one neither holds
 */
function rowNow(editing: ScheduleEditing, held: FlowchartHeld, kind: AnyKind, sort: FlowchartSort, key: string): Uint8Array | undefined {
    const entry = editing.sessions.find((part) => stringEqual(part.kind, sort))?.session.entries.get(key);
    if (entry !== undefined) {
        const row = draftedRow(entry);
        return row === undefined ? undefined : rowCodec(kind.rowType).encode(row.row);
    }
    const rows: ReadonlyMap<string, { readonly row: Uint8Array }> | undefined = held[sort];
    return rows?.get(key)?.row;
}

/**
 * The Flowchart's sessions over its records, and their drafts (see the module
 * docs).
 *
 * @param value - The payload
 * @param storageKey - The Flowchart's key: its sessions and their history are kept under it
 * @param recordSlices - The slice's parts over the kinds read through their sources: each Save notice counts what leaves its own
 * @param held - Each kind's stored rows the read holds: the keys a new row's key is unique among
 * @param words - What the key check says
 * @param retained - Whether what the canvas draws is retained: no record takes an edit while it is
 * @returns The editing
 */
export function useFlowchartEditing(value: FlowchartValue, storageKey: string, recordSlices: readonly ValueTypeOf<RecordSliceBindType>[],
    held: FlowchartHeld, words: FlowchartKeyCheckWords, retained = false): FlowchartEditing {
    // The sessions, the rows read and the words as they stand when the history's check is made. The sessions are the
    // history's, known once it is made: before then — a first render over drafts kept from before — every drafted row the
    // read does not hold is asked for, and the check is made again, knowing them, once the answer lands.
    const sessionsNow = useRef<readonly ScheduleKindSession[]>([]);
    const heldNow = useRef(held);
    heldNow.current = held;
    const wordsNow = useRef(words);
    wordsNow.current = words;
    // Each kind bound with its patch door — none while the Flowchart is read only (R13) — its check composed with the key
    // check where its source's narrowing hides rows (D3), and its form: a changed row's number outside its field's bounds
    // holds Save as the app's check does (#1585).
    const records = useMemo((): ScheduleEditingRecord[] => {
        if (value.readOnly) return [];
        const chrome = getSomeorUndefined(value.slice);
        const out: ScheduleEditingRecord[] = [];
        for (const sort of FLOWCHART_SORTS) {
            const kind = kindOf(value, sort);
            if (kind === undefined || !kind.editable || kind.editing.type !== "some") continue;
            const part = (sort === "states" || sort === "transitions") && value.narrowed.type === "hide" ? sourcePart(chrome, sort) : undefined;
            const app = someOf(kind.ready);
            const keyed = kindKeys(kind.keyType);
            // A new row held under a placeholder, its key the viewer's to type: its kind makes none of its own (#1549).
            const placeholders = !keyed.text && kind.keyType.type !== "Integer" && builderOf(kind) === undefined;
            // The app's check over rows each under a key, and the key check where the narrowing hides rows (D3).
            const keyedReady = (batch: { id: string; entry: Uint8Array }[]): Readiness[] => {
                const verdicts = app === undefined ? batch.map(() => READY) : app(batch);
                if (part === undefined) return verdicts;
                // The rows new to the record: their session found none of their key before the gesture that wrote them, and
                // the read holds none — a row it holds is e3's, and a Save's confirmation settles one written since. Each is
                // asked at the kind's key type: a text no key prints as, e3 holds none of.
                const session = sessionsNow.current.find((s) => stringEqual(s.kind, sort))?.session;
                const read: ReadonlyMap<string, unknown> | undefined = heldNow.current[sort];
                const fresh = batch.flatMap(({ id }, i) => {
                    if (draftedRow(session?.originals.get(id)) !== undefined || read?.has(id) === true) return [];
                    const key = keyed.keyOf(id);
                    return key === undefined ? [] : [{ at: i, key }];
                });
                if (fresh.length === 0) return verdicts;
                const asked = recordSliceRows(part, fresh.map(({ key }) => key));
                const out = [...verdicts];
                fresh.forEach(({ at }, n) => {
                    const key = batch[at]!.id;
                    if (asked.type !== "some") {
                        out[at] = variant("incomplete", [{ field: "", message: wordsNow.current.checking({ sort, key }) }]);
                    } else if (asked.value[n]?.type === "some") {
                        out[at] = variant("invalid", [{ field: "", message: wordsNow.current.held({ sort, key }) }]);
                    }
                });
                return out;
            };
            const ready = part === undefined && !placeholders ? kind.ready : some((batch: { id: string; entry: Uint8Array }[]): Readiness[] => {
                if (!placeholders) return keyedReady(batch);
                // A row under a placeholder waits on its key, at its key field; neither check is asked of it.
                const out = batch.map(({ id }): Readiness => (keyed.isKey(id) ? READY
                    : variant("incomplete", [{ field: "key", message: wordsNow.current.placeholder({ sort }) }])));
                const rest = batch.flatMap((entry, i) => (keyed.isKey(entry.id) ? [{ entry, i }] : []));
                if (rest.length > 0) keyedReady(rest.map(({ entry }) => entry)).forEach((verdict, n) => { out[rest[n]!.i] = verdict; });
                return out;
            });
            // A kind read by key keeps what each Save landed: the frame's stored rows are read apart from its confirmation.
            out.push({ key: sort, name: kind.name, editing: kind.editing.value, entries: kind.entries, ready, fields: kind.fields, drawsLanded: kind.entries.type === "some" });
        }
        return out;
    }, [value]);
    // A kind read through its source: the rows its source's read holds, kept at the revision they were read at — a
    // gesture's original, and what a Save confirms its entries by; any other row is read by its key.
    const reads = useMemo((): Record<string, ScheduleRowRead> => {
        const out: Record<string, ScheduleRowRead> = {};
        for (const sort of FLOWCHART_SORTS) {
            const kind = kindOf(value, sort);
            if (kind === undefined || !kind.editable || kind.entries.type !== "some") continue;
            const rows = keptAtRevision<ReadonlyMap<string, { readonly row: Uint8Array }>>(kind.entries, () => kind.rows());
            out[sort] = (key) => heldInWindow(rows(), key);
        }
        return out;
    }, [value]);
    const schedule = useScheduleEditing({ kinds: NO_KINDS, records, reads, storageKey, joined: NO_JOINED, recordSlices, autosave: value.autosave });
    sessionsNow.current = schedule.sessions;

    // Each draft decoded once: a session keeps an entry's version the same object until a gesture replaces it.
    const decoded = useRef(new WeakMap<EntryVersion<ScheduleEntryRef>, DraftedRow<unknown>>());
    const draftsNow = schedule.drafts;
    const drafts = useMemo((): FlowchartDrafts => {
        const sortDrafts = <R,>(sort: FlowchartSort): KindDrafts<R> => {
            const kind = kindOf(value, sort);
            const ids = schedule.draftsOf(sort);
            const rows = new Map<string, DraftedRow<R> | undefined>();
            if (kind === undefined || ids.size === 0) return rows;
            const session = schedule.sessions.find((part) => stringEqual(part.kind, sort))?.session;
            const codec = rowCodec(kind.rowType);
            const read = kind.read as (bytes: Uint8Array, key: string) => R;
            // A row under a placeholder is read as keyed by its key type's default, its key still to be typed (#1549).
            const keys = kindKeys(kind.keyType);
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
                        roles: read(codec.encode(row.row), keys.readKey(id)), created: began === undefined,
                        began: began === undefined ? undefined : read(codec.encode(began), keys.readKey(id)),
                    };
                    decoded.current.set(entry, drafted);
                }
                rows.set(id, drafted);
            }
            return rows;
        };
        return {
            states: sortDrafts<FlowchartStateRoles>("states"),
            transitions: sortDrafts<FlowchartTransitionRoles>("transitions"),
            lanes: sortDrafts<FlowchartLaneRoles>("lanes"),
            decisions: sortDrafts<FlowchartDecisionRoles>("decisions"),
        };
        // The drafts move with every gesture: their bytes say when.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftsNow, value]);

    // What each Save landed of a kind read by key, each row decoded once: a session keeps a landed entry the same object
    // until it lets it go.
    const landedDecoded = useRef(new WeakMap<LandedEntry<ScheduleEntryRef>, LandedRow<unknown>>());
    const version = schedule.version;
    const landed = useMemo((): FlowchartLanded => {
        const of = <R,>(sort: FlowchartSort): KindLanded<R> => {
            const kind = kindOf(value, sort);
            const entries = kind === undefined ? undefined : schedule.sessions.find((part) => stringEqual(part.kind, sort))?.session.landed;
            if (kind === undefined || entries === undefined || entries.size === 0) return NONE_LANDED;
            const codec = rowCodec(kind.rowType);
            const keys = kindKeys(kind.keyType);
            const read = kind.read as (bytes: Uint8Array, key: string) => R;
            const rows = new Map<string, LandedRow<R>>();
            for (const [id, entry] of entries) {
                let row = landedDecoded.current.get(entry) as LandedRow<R> | undefined;
                if (row === undefined) {
                    // A row the Save deleted is none; one it added, a row its session found none of before.
                    const after = draftedRow(entry.after);
                    row = {
                        drawn: after === undefined ? undefined : { roles: read(codec.encode(after.row), keys.readKey(id)), created: draftedRow(entry.before) === undefined },
                        from: entry.from,
                    };
                    landedDecoded.current.set(entry, row);
                }
                rows.set(id, row);
            }
            return rows;
        };
        const states = of<FlowchartStateRoles>("states"), transitions = of<FlowchartTransitionRoles>("transitions");
        const lanes = of<FlowchartLaneRoles>("lanes"), decisions = of<FlowchartDecisionRoles>("decisions");
        // Nothing landed is the one object, so what reads it holds still while gestures move the history.
        return states.size + transitions.size + lanes.size + decisions.size === 0 ? NO_LANDED : { states, transitions, lanes, decisions };
        // What the sessions keep moves with the history's version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, schedule.sessions, value]);

    // Stable to the canvas: each calls the latest render's.
    const latest = useRef({ value, schedule, held, retained });
    latest.current = { value, schedule, held, retained };
    const shown = useCallback((sort: FlowchartSort, keys: readonly string[]): void => {
        latest.current.schedule.sessions.find((part) => stringEqual(part.kind, sort))?.session.shown(keys);
    }, []);
    const editedSorts = useMemo(() => new Set(records.map((record) => record.key)), [records]);
    const editable = useCallback((sort: FlowchartSort): boolean => editedSorts.has(sort), [editedSorts]);
    // Retained, no record takes an edit: every route asks it, and `record` refuses one.
    const scheduleAvailable = schedule.available;
    const available = useCallback((sort: FlowchartSort): boolean => !retained && editedSorts.has(sort) && scheduleAvailable(sort),
        [retained, editedSorts, scheduleAvailable]);
    // A gesture's edits as the shared editing records them, each row through its kind's own functions; `undefined` where
    // a kind refuses one.
    const changesOf = useCallback((edits: readonly FlowchartEdit[]): ScheduleChange[] | undefined => {
        const { value: payload, schedule: editing, held: read } = latest.current;
        const transitions = getSomeorUndefined(payload.transitions);
        const lanes = getSomeorUndefined(payload.lanes);
        const decisions = getSomeorUndefined(payload.decisions);
        const changes: ScheduleChange[] = [];
        for (const edit of edits) {
            switch (edit.op) {
                case "createState": {
                    // A row the app's `values` fail to make, as one its kind refuses, records nothing.
                    const row = madeFromValues("Flowchart", `a new ${payload.states.name}`, () => payload.states.create(edit.write, edit.values));
                    if (row?.type !== "some") return undefined;
                    changes.push({ kind: "states", id: edit.key, row: row.value, created: true });
                    break;
                }
                case "writeState": {
                    const write = edit.write;
                    changes.push({ kind: "states", id: edit.key, rewrite: (row) => someOf(payload.states.write(row, write)) });
                    break;
                }
                case "createTransition": {
                    const row = transitions === undefined ? undefined
                        : madeFromValues("Flowchart", `a new ${transitions.name}`, () => transitions.create(edit.write, edit.values));
                    if (row?.type !== "some") return undefined;
                    changes.push({ kind: "transitions", id: edit.key, row: row.value, created: true });
                    break;
                }
                case "writeTransition": {
                    if (transitions === undefined) return undefined;
                    const write = edit.write;
                    changes.push({ kind: "transitions", id: edit.key, rewrite: (row) => someOf(transitions.write(row, write)) });
                    break;
                }
                case "retypeTransition": {
                    // A card's values over the ends the row holds as the gesture finds it: they and its key stay.
                    if (transitions === undefined) return undefined;
                    const { key, values } = edit;
                    changes.push({ kind: "transitions", id: key, rewrite: (row) => {
                        const roles = transitions.read(row, key);
                        return someOf(transitions.create({ from: some(roles.from), to: some(roles.to), decision: none }, some(values)));
                    } });
                    break;
                }
                case "createLane": {
                    const row = lanes === undefined ? undefined : madeFromValues("Flowchart", `a new ${lanes.name}`, () => lanes.create(edit.write, edit.values));
                    if (row?.type !== "some") return undefined;
                    changes.push({ kind: "lanes", id: edit.key, row: row.value, created: true });
                    break;
                }
                case "writeLane": {
                    if (lanes === undefined) return undefined;
                    const write = edit.write;
                    changes.push({ kind: "lanes", id: edit.key, rewrite: (row) => someOf(lanes.write(row, write)) });
                    break;
                }
                case "unqueue": {
                    const unqueue = decisions === undefined ? undefined : someOf(decisions.unqueue);
                    if (unqueue === undefined) return undefined;
                    const state = edit.state;
                    // A queue no longer holding the key, as its session finds it, stays as it is.
                    changes.push({ kind: "decisions", id: edit.key, rewrite: (row) => someOf(unqueue(row, state)) ?? row });
                    break;
                }
                case "requeue": {
                    const requeue = decisions === undefined ? undefined : someOf(decisions.requeue);
                    if (requeue === undefined) return undefined;
                    const { from, to } = edit;
                    // A queue no longer holding the old key, as its session finds it, stays as it is.
                    changes.push({ kind: "decisions", id: edit.key, rewrite: (row) => someOf(requeue(row, from, to)) ?? row });
                    break;
                }
                case "set": {
                    const kind = kindOf(payload, edit.sort);
                    if (kind === undefined) return undefined;
                    const sets = edit.sets;
                    changes.push({ kind: edit.sort, id: edit.key, rewrite: (row) => someOf(kind.set(row, [...sets])) });
                    break;
                }
                case "row":
                    changes.push({ kind: edit.sort, id: edit.key, row: edit.row });
                    break;
                case "copy": {
                    const kind = kindOf(payload, edit.sort);
                    const from = kind === undefined ? undefined : rowNow(editing, read, kind, edit.sort, edit.from);
                    if (kind === undefined || from === undefined) return undefined;
                    let row = from;
                    if (edit.order !== undefined) {
                        const order = some(edit.order);
                        const placed = edit.sort === "states" ? payload.states.write(row, { label: none, lane: none, order })
                            : edit.sort === "lanes" && lanes !== undefined ? lanes.write(row, { label: none, order }) : some(row);
                        if (placed.type !== "some") return undefined;
                        row = placed.value;
                    }
                    changes.push({ kind: edit.sort, id: edit.key, row, ...(edit.replaces === true ? {} : { created: true as const }) });
                    break;
                }
                case "remove":
                    changes.push({ kind: edit.sort, id: edit.key, remove: true });
                    break;
            }
        }
        return changes;
    }, []);
    const record = useCallback((edits: readonly FlowchartEdit[], origin: Origin, label: string): boolean => {
        if (latest.current.retained) return false;
        const changes = changesOf(edits);
        return changes !== undefined && changes.length > 0 && latest.current.schedule.record(changes, origin, label);
    }, [changesOf]);
    const taken = useCallback((sort: FlowchartSort, key: string): boolean => {
        const { schedule: editing, held: read } = latest.current;
        const session = editing.sessions.find((part) => stringEqual(part.kind, sort))?.session;
        if (session?.entries.has(key) === true) return true;
        const rows: ReadonlyMap<string, unknown> | undefined = read[sort];
        return rows?.has(key) === true;
    }, []);
    const stands = useCallback((sort: FlowchartSort, key: string): boolean => {
        const { schedule: editing, held: read } = latest.current;
        const entry = editing.sessions.find((part) => stringEqual(part.kind, sort))?.session.entries.get(key);
        if (entry !== undefined) return draftedRow(entry) !== undefined;
        const rows: ReadonlyMap<string, unknown> | undefined = read[sort];
        return rows?.has(key) === true;
    }, []);
    const mintTransition = useCallback((minted: ReadonlySet<string>): string => mintKey((key) => minted.has(key) || taken("transitions", key)), [taken]);
    const newKey = useCallback((sort: FlowchartSort, made: FlowchartEdit, madeUp: (held: (key: string) => boolean) => string,
        minted: ReadonlySet<string> = NO_MINTED): FlowchartNewKey | undefined => {
        const { value: payload, schedule: editing } = latest.current;
        const kind = kindOf(payload, sort);
        if (kind === undefined) return undefined;
        const keys = kindKeys(kind.keyType);
        const holds = (key: string): boolean => minted.has(key) || taken(sort, key);
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
                console.error(`[Flowchart] ${kind.name}'s key could not be built from a new row:`, err);
                return undefined;
            }
            return minted.has(key) || stands(sort, key) ? { taken: key } : { key };
        }
        if (keys.text) return { key: madeUp(holds) };
        if (kind.keyType.type === "Integer") {
            const key = editing.mint(sort, "", minted);
            return key === undefined ? undefined : { key };
        }
        // A placeholder: a text made up that no key prints as, until the viewer types its key.
        if (keys.typed) return { key: madeUp((key) => keys.isKey(key) || holds(key)) };
        return { untyped: kind.keyType.type };
    }, [changesOf, taken, stands]);
    const moves = useCallback((edits: readonly FlowchartEdit[]): FlowchartMove[] => {
        const { value: payload, schedule: editing, held: read } = latest.current;
        const changes = changesOf(edits);
        // A gesture touching no kind that builds its keys moves no row: its edits are never composed.
        if (changes === undefined || !changes.some((change) => builderOf(kindOf(payload, change.kind as FlowchartSort)) !== undefined)) return [];
        // Each row the gesture touches as it leaves it, the edits composed in order over the row as it finds it.
        const at = (sort: string, key: string): string => `${sort}\u0000${key}`;
        const found = (sort: FlowchartSort, key: string): Uint8Array | undefined => {
            const kind = kindOf(payload, sort);
            return kind === undefined ? undefined : rowNow(editing, read, kind, sort, key);
        };
        const now = new Map<string, Uint8Array | undefined>();
        const made = new Set<string>();
        const touched: { sort: FlowchartSort; key: string }[] = [];
        const seen = new Set<string>();
        for (const change of changes) {
            const sort = change.kind as FlowchartSort;
            const id = at(sort, change.id);
            if (!seen.has(id)) { seen.add(id); touched.push({ sort, key: change.id }); }
            const was = now.has(id) ? now.get(id) : found(sort, change.id);
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
        const out: FlowchartMove[] = [];
        for (const { sort, key } of touched) {
            const id = at(sort, key);
            const build = builderOf(kindOf(payload, sort));
            const was = found(sort, key);
            const after = now.get(id);
            if (made.has(id) || build === undefined || was === undefined || after === undefined) continue;
            try {
                const to = build(after);
                if (!stringEqual(build(was), to) && !stringEqual(key, to)) out.push({ sort, key, to });
            } catch (err) {
                console.error(`[Flowchart] ${kindOf(payload, sort)?.name ?? sort}'s key could not be built from ${key}'s row:`, err);
            }
        }
        return out;
    }, [changesOf]);
    const builds = useCallback((sort: FlowchartSort): boolean => builderOf(kindOf(latest.current.value, sort)) !== undefined, []);
    const untyped = useCallback((sort: FlowchartSort): string | undefined => {
        const kind = kindOf(latest.current.value, sort);
        if (kind === undefined || builderOf(kind) !== undefined) return undefined;
        const keys = kindKeys(kind.keyType);
        return keys.text || kind.keyType.type === "Integer" || keys.typed ? undefined : kind.keyType.type;
    }, []);
    const unqueues = getSomeorUndefined(value.decisions)?.unqueue.type === "some";
    // An Integer order takes a whole number alone: its create gives none for another, over the type's defaults — never
    // asking the app's values of a lane it refuses. A create that asks them and fails takes a fraction.
    const wholeLaneOrders = useMemo(() => {
        const lanes = getSomeorUndefined(value.lanes);
        if (lanes === undefined) return false;
        try {
            return lanes.create({ label: none, order: some(0.5) }, none).type !== "some";
        } catch {
            return false;
        }
    }, [value]);

    return useMemo(() => ({
        schedule, history: schedule.history, edits: records.length > 0, drafts, landed, version: schedule.version, unqueues, wholeLaneOrders,
        shown, editable, available, record, taken, stands, mintTransition, newKey, moves, builds, untyped,
    }), [schedule, records.length, drafts, landed, unqueues, wholeLaneOrders, shown, editable, available, record, taken, stands, mintTransition, newKey, moves, builds, untyped]);
}
