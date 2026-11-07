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
 *   state's key through its kind's `unqueue`; a field of the form through its
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
 * - **Its drafts.** Each draft is decoded once: its roles read through its
 *   kind's `read`, kept while its session keeps the entry's version — what the
 *   frame draws over the stored rows (`drafted.ts`).
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
import { getSomeorUndefined, type EditHistory, type EntryVersion, type Origin } from "@elaraai/east-ui-components";
import { recordSliceRows } from "@elaraai/east-ui-components/internal";
import {
    useScheduleEditing,
    type ScheduleChange, type ScheduleEditing, type ScheduleEditingKind, type ScheduleEditingRecord, type ScheduleEntryRef, type ScheduleKindSession,
    type ScheduleRowRead,
} from "../shared/schedule/editing.js";
import { kindKeys } from "../shared/schedule/kind-keys.js";
import { draftedRow, heldInWindow, keptAtRevision, mintKey, rowCodec } from "../shared/schedule/records.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import type { DraftedRow, FlowchartDrafts, KindDrafts } from "./drafted.js";
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
    /** Fields no role writes: the form's, or an author's card's. */
    | { readonly op: "set"; readonly sort: FlowchartSort; readonly key: string; readonly sets: FlowchartFieldWrites }
    /** A row whole: the one a kind's own Details hands back. */
    | { readonly op: "row"; readonly sort: FlowchartSort; readonly key: string; readonly row: Uint8Array }
    /**
     * A new row under `key`, a copy of the row under `from` as its session finds it — a duplicate, or a new row under the
     * key the form gives it — its order written where given.
     */
    | { readonly op: "copy"; readonly sort: FlowchartSort; readonly key: string; readonly from: string; readonly order?: number | undefined }
    | { readonly op: "remove"; readonly sort: FlowchartSort; readonly key: string };

/** What the key check says, in the flowchart's words. */
export interface FlowchartKeyCheckWords {
    /** A new row's key e3 holds already — `A state is keyed "SCN" already`. */
    readonly held: (p: { sort: FlowchartSort; key: string }) => string;
    /** While e3 is asked for it — `Checking the key "SCN"`. */
    readonly checking: (p: { sort: FlowchartSort; key: string }) => string;
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
    /** The history's version: it moves with every change of it or of its sessions. */
    readonly version: number;
    /** Whether the decisions take a state's key out of their queues: a queue is given them. */
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
     * A new transition's key: minted unique (`crypto.randomUUID()`) among every key the Flowchart has read and drafted
     * of the transitions, and those given — never drawn (R9).
     *
     * @param minted - The keys the gesture has minted already
     */
    mintTransition(minted: ReadonlySet<string>): string;
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
    // check where its source's narrowing hides rows (D3).
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
            const ready = part === undefined ? kind.ready : some((batch: { id: string; entry: Uint8Array }[]): Readiness[] => {
                const verdicts = app === undefined ? batch.map(() => READY) : app(batch);
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
            });
            out.push({ key: sort, name: kind.name, editing: kind.editing.value, entries: kind.entries, ready });
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
    const schedule = useScheduleEditing({ kinds: NO_KINDS, records, reads, storageKey, joined: NO_JOINED, recordSlices });
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
                        roles: read(codec.encode(row.row), id), created: began === undefined,
                        began: began === undefined ? undefined : read(codec.encode(began), id),
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

    // Stable to the canvas: each calls the latest render's.
    const latest = useRef({ value, schedule, held, retained });
    latest.current = { value, schedule, held, retained };
    const editedSorts = useMemo(() => new Set(records.map((record) => record.key)), [records]);
    const editable = useCallback((sort: FlowchartSort): boolean => editedSorts.has(sort), [editedSorts]);
    // Retained, no record takes an edit: every route asks it, and `record` refuses one.
    const scheduleAvailable = schedule.available;
    const available = useCallback((sort: FlowchartSort): boolean => !retained && editedSorts.has(sort) && scheduleAvailable(sort),
        [retained, editedSorts, scheduleAvailable]);
    const record = useCallback((edits: readonly FlowchartEdit[], origin: Origin, label: string): boolean => {
        const { value: payload, schedule: editing, held: read, retained: standingIn } = latest.current;
        if (standingIn) return false;
        const transitions = getSomeorUndefined(payload.transitions);
        const lanes = getSomeorUndefined(payload.lanes);
        const decisions = getSomeorUndefined(payload.decisions);
        const changes: ScheduleChange[] = [];
        for (const edit of edits) {
            switch (edit.op) {
                case "createState": {
                    const row = payload.states.create(edit.write, edit.values);
                    if (row.type !== "some") return false;
                    changes.push({ kind: "states", id: edit.key, row: row.value, created: true });
                    break;
                }
                case "writeState": {
                    const write = edit.write;
                    changes.push({ kind: "states", id: edit.key, rewrite: (row) => someOf(payload.states.write(row, write)) });
                    break;
                }
                case "createTransition": {
                    const row = transitions?.create(edit.write, edit.values);
                    if (row === undefined || row.type !== "some") return false;
                    changes.push({ kind: "transitions", id: edit.key, row: row.value, created: true });
                    break;
                }
                case "writeTransition": {
                    if (transitions === undefined) return false;
                    const write = edit.write;
                    changes.push({ kind: "transitions", id: edit.key, rewrite: (row) => someOf(transitions.write(row, write)) });
                    break;
                }
                case "retypeTransition": {
                    // A card's values over the ends the row holds as the gesture finds it: they and its key stay.
                    if (transitions === undefined) return false;
                    const { key, values } = edit;
                    changes.push({ kind: "transitions", id: key, rewrite: (row) => {
                        const roles = transitions.read(row, key);
                        return someOf(transitions.create({ from: some(roles.from), to: some(roles.to), decision: none }, some(values)));
                    } });
                    break;
                }
                case "createLane": {
                    const row = lanes?.create(edit.write, edit.values);
                    if (row === undefined || row.type !== "some") return false;
                    changes.push({ kind: "lanes", id: edit.key, row: row.value, created: true });
                    break;
                }
                case "writeLane": {
                    if (lanes === undefined) return false;
                    const write = edit.write;
                    changes.push({ kind: "lanes", id: edit.key, rewrite: (row) => someOf(lanes.write(row, write)) });
                    break;
                }
                case "unqueue": {
                    const unqueue = decisions === undefined ? undefined : someOf(decisions.unqueue);
                    if (unqueue === undefined) return false;
                    const state = edit.state;
                    // A queue no longer holding the key, as its session finds it, stays as it is.
                    changes.push({ kind: "decisions", id: edit.key, rewrite: (row) => someOf(unqueue(row, state)) ?? row });
                    break;
                }
                case "set": {
                    const kind = kindOf(payload, edit.sort);
                    if (kind === undefined) return false;
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
                    if (kind === undefined || from === undefined) return false;
                    let row = from;
                    if (edit.order !== undefined) {
                        const order = some(edit.order);
                        const placed = edit.sort === "states" ? payload.states.write(row, { label: none, lane: none, order })
                            : edit.sort === "lanes" && lanes !== undefined ? lanes.write(row, { label: none, order }) : some(row);
                        if (placed.type !== "some") return false;
                        row = placed.value;
                    }
                    changes.push({ kind: edit.sort, id: edit.key, row, created: true });
                    break;
                }
                case "remove":
                    changes.push({ kind: edit.sort, id: edit.key, remove: true });
                    break;
            }
        }
        return changes.length > 0 && editing.record(changes, origin, label);
    }, []);
    const taken = useCallback((sort: FlowchartSort, key: string): boolean => {
        const { schedule: editing, held: read } = latest.current;
        const session = editing.sessions.find((part) => stringEqual(part.kind, sort))?.session;
        if (session?.entries.has(key) === true) return true;
        const rows: ReadonlyMap<string, unknown> | undefined = read[sort];
        return rows?.has(key) === true;
    }, []);
    const mintTransition = useCallback((minted: ReadonlySet<string>): string => mintKey((key) => minted.has(key) || taken("transitions", key)), [taken]);
    const unqueues = getSomeorUndefined(value.decisions)?.unqueue.type === "some";
    // An Integer order takes a whole number alone: its create gives none for another, over the type's defaults.
    const wholeLaneOrders = useMemo(() => {
        const lanes = getSomeorUndefined(value.lanes);
        return lanes !== undefined && lanes.create({ label: none, order: some(0.5) }, none).type !== "some";
    }, [value]);

    return useMemo(() => ({
        schedule, history: schedule.history, edits: records.length > 0, drafts, version: schedule.version, unqueues, wholeLaneOrders,
        editable, available, record, taken, mintTransition,
    }), [schedule, records.length, drafts, unqueues, wholeLaneOrders, editable, available, record, taken, mintTransition]);
}
