/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The DecisionQueue's editing (`Decision Queue Spec.md` Q1, D1, D3, R23):
 * one history over a session per record the queue writes — the cases' own
 * record, whose rows hold the verdicts, and each record a change lands in,
 * one session a record however many targets draw it — through the shared
 * Schedule editing, as the Roster's records are. A verdict is one step across
 * them: the verdict written into the case's own row through the cases'
 * `write` — the row as its session finds it, drafted or as read, every field
 * the verdict's roles leave as it was — and, for Apply, the rows the chosen
 * option's change leaves — the target's `apply` over the rows it touches as
 * they stand, drafted or stored, with Modify's edits in place — each drafted
 * whole into its record. A case's row is found where the list read it, at the
 * revision it read it at, else by its key; the rows a change touches are read
 * at once, a record's stored rows by key in one request ({@link standingRows}),
 * never a request or two a key. Save sends each record's changes through its
 * patch door as a request of its own, and its notice counts the cases it took
 * out of the narrowing (R26).
 *
 * @packageDocumentation
 */

import { useMemo, useRef } from "react";
import {
    BlobType, EastTypeType, OptionType, SortedMap, StringType, compareFor, equalFor, fromEastTypeValue, none, parseFor, some, variant,
    type EastType, type EastTypeValue, type ValueTypeOf, type option,
} from "@elaraai/east";
import { DECISIONS_SOURCE, type DecisionQueuePayloadType, type DecisionTargetType, type DecisionVerdictType } from "@elaraai/e3-ui/internal";
import type { BatchReadiness, EditHistory } from "@elaraai/east-ui-components";
import { wholeEntryReadiness } from "@elaraai/east-ui-components/internal";
import { defaultPagedRuntime, pagedSourceOf, type PagedRow } from "../platform/paged-runtime.js";
import {
    useScheduleEditing, type ScheduleChange, type ScheduleEditing, type ScheduleEditingRecord, type ScheduleEntryRef, type ScheduleRowRead,
} from "../shared/schedule/editing.js";
import { draftedRow, rowCodec, type RowCodec } from "../shared/schedule/records.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import type { DecisionRead } from "./data.js";
import type { DecisionCase, DecisionOption } from "./cases.js";
import { decisionQueueMessages, type DecisionAnswerWord, type DecisionReasonWord, type DecisionVerdictWord } from "./messages.js";

/** The queue's payload, decoded. */
export type DecisionQueueValue = ValueTypeOf<DecisionQueuePayloadType>;
/** One target, decoded. */
export type DecisionTarget = ValueTypeOf<typeof DecisionTargetType>;
/** A verdict, decoded. */
export type DecisionVerdictValue = ValueTypeOf<typeof DecisionVerdictType>;

/** What a change names the cases' own record by in the history: the record whose rows hold the verdicts. */
export const CASES = "decision.cases";

const compareString = compareFor(StringType);
const stringEqual = equalFor(StringType);
const blobEqual = equalFor(OptionType(BlobType));
const sameTypeValue = equalFor(EastTypeType);
const NO_JOINED: Parameters<typeof useScheduleEditing>[0]["joined"] = [];
const NO_KINDS: Parameters<typeof useScheduleEditing>[0]["kinds"] = [];
const READY: BatchReadiness = variant("ready", null);
/** The rows a verdict writes are checked whole: none of them is told from an original. */
const NO_ORIGINALS = () => undefined;
const NEVER_EQUAL = () => false;

/** A record a target draws, as the queue writes it: its session, and the app's check over its rows. */
export interface DecisionRecord extends ScheduleEditingRecord {
    /**
     * The app's check over its rows (D9): its kind's, or its side's, `ready` — what holds its builder's Save — which holds
     * Apply while a row the verdict would write fails it, and the record's Save as it holds every builder's; none unless given.
     */
    readonly ready: NonNullable<ScheduleEditingRecord["ready"]>;
}

/**
 * The record a target draws, as the queue writes it (D6): its session and its
 * read by key where its kind carries them — a record no builder draws its
 * side's, a builder's the kind its tags patch, the Sheet's the queue's own
 * over its record, whole rows as every other's — keyed in the history by the
 * record's identity, so two targets over one record share its session; and
 * the app's check over its rows, where its kind gives one (D9) — the Sheet's
 * is over its cells, never a row, and holds no verdict.
 *
 * @param target - The target
 * @returns Its record; `undefined` for a target whose kind carries no session the queue can write
 */
export function targetRecord(target: DecisionTarget): DecisionRecord | undefined {
    const kind = target.kind;
    const of = (editing: ScheduleEditingRecord["editing"], entries: ScheduleEditingRecord["entries"], ready: DecisionRecord["ready"]): DecisionRecord =>
        ({ key: `decision.record.${editing.sourceId}`, name: target.name, editing, entries, ready });
    switch (kind.type) {
        case "record": case "zones": case "projection":
            return kind.value.editing.type === "some" ? of(kind.value.editing.value, kind.value.entries, kind.value.ready) : undefined;
        case "roster": {
            const duty = kind.value.roster.duty.kind;
            return of(duty.editing, duty.entries, duty.ready);
        }
        case "plan": case "calendar": {
            const slot = kind.value.event;
            const events = kind.value.events.find(k => stringEqual(k.key, slot));
            return events === undefined ? undefined : of(events.editing, events.entries, events.ready);
        }
        case "allocation": {
            const bins = kind.value.bin.kind;
            return of(bins.editing, bins.entries, bins.ready);
        }
        case "sheet":
            return of(kind.value.editing, kind.value.entries, none);
    }
}

/**
 * The app's check over the rows a verdict would write (D9): each row it writes,
 * as its record decodes it, checked by the record's `ready` in one call, as
 * its session checks a drafted row — a check that throws refuses every row it
 * was asked about; a row it removes is none of the check's. Read inside a
 * tracked evaluation: the check may read the app's data.
 *
 * @param record - The record
 * @param rows - The rows it would write, by key: `undefined` for one it removes
 * @returns Their readiness, each issue naming its row by its key's text; ready where the record gives no check
 */
export function rowsReadiness(record: DecisionRecord, rows: ReadonlyMap<string, Uint8Array | undefined>): BatchReadiness {
    if (record.ready.type !== "some") return READY;
    const codec = rowCodec(record.editing.entryType);
    const entries = new Map<string, { draft: unknown }>();
    for (const [id, row] of rows) if (row !== undefined) entries.set(id, { draft: variant("value", codec.decode(row)) });
    return wholeEntryReadiness(record.ready.value, NO_ORIGINALS, { encode: codec.encode, equal: NEVER_EQUAL })(entries);
}

/** The queue's editing: its history over the cases' record and the targets' records, and how a verdict is made of a decision. */
export interface DecisionEditing {
    /** The shared Schedule editing over the records: how a step is recorded, and what each record holds. */
    readonly schedule: ScheduleEditing;
    /** The one history over them. */
    readonly history: EditHistory<ScheduleEntryRef>;
    /** Each target's record, in the targets' order: `undefined` for a target whose kind carries none. */
    readonly records: readonly (DecisionRecord | undefined)[];
}

/** Each read's cases by their key, made once a read: what the cases' session finds a row in. */
const readKeys = new WeakMap<ReadonlyMap<number, DecisionCase>, ReadonlyMap<string, DecisionCase>>();

/**
 * A case the list read, by its key.
 *
 * @param read - The read
 * @param id - The case's key
 * @returns The case; `undefined` for one the read does not hold
 */
function readCase(read: DecisionRead, id: string): DecisionCase | undefined {
    let byKey = readKeys.get(read.rows);
    if (byKey === undefined) {
        const made = new Map<string, DecisionCase>();
        for (const c of read.rows.values()) made.set(c.key, c);
        readKeys.set(read.rows, made);
        byKey = made;
    }
    return byKey.get(id);
}

/**
 * The queue's sessions (see the module docs). Through the slice's source, a
 * case's row is found where the list last read it — what a verdict rewrites,
 * and what Save's confirmation reads, before any row is read by its key —
 * while that read is at the revision the cases' record reads; and Save's
 * notice counts the cases it took out of the source's narrowing. The editing
 * is made again as a record comes to take a gesture, or stops — its first
 * read landing — so a card reads the rows its change touches then.
 *
 * @param value - The payload
 * @param storageKey - The queue's key: its sessions and their history are kept under it, whatever the narrowing or a remount
 * @param read - The cases the list last read; `undefined` before a read has landed
 * @returns The editing
 */
export function useDecisionEditing(value: DecisionQueueValue, storageKey: string, read: DecisionRead | undefined): DecisionEditing {
    const { decisions, targets } = value;
    const { records, byTarget } = useMemo(() => {
        const byTarget = targets.map(targetRecord);
        // One session a record, however many targets draw it.
        const distinct: DecisionRecord[] = [];
        for (const record of byTarget) if (record !== undefined && !distinct.some(held => stringEqual(held.key, record.key))) distinct.push(record);
        const records: ScheduleEditingRecord[] = [
            { key: CASES, name: decisionQueueMessages.casesSession(), editing: decisions.editing, entries: decisions.entries }, ...distinct,
        ];
        return { records, byTarget };
    }, [decisions, targets]);
    // The rows the list last read, as the cases' session finds them: one object while the record's read holds, so the
    // sessions are made once — it reads the latest read as it runs.
    const latest = useRef(read);
    latest.current = read;
    const entries = decisions.entries;
    const reads = useMemo((): Readonly<Record<string, ScheduleRowRead>> | undefined => {
        if (entries.type !== "some") return undefined;
        const seam = entries.value;
        return {
            [CASES]: (id) => {
                const held = latest.current;
                if (held === undefined || held.revision === undefined) return undefined;
                // Pinned to the revision it was read at: a read at another than the record's is no row of the Save's.
                const at = seam.revision();
                if (at.type === "some" && !stringEqual(at.value, held.revision)) return undefined;
                const c = readCase(held, id);
                return c === undefined ? undefined : some(some(c.row));
            },
        };
    }, [entries]);
    const slice = value.slice.type === "some" ? value.slice.value : undefined;
    const recordSlices = useMemo(() => {
        const part = sourcePart(slice, DECISIONS_SOURCE);
        return part === undefined ? undefined : [part];
    }, [slice]);
    const editing = useScheduleEditing({ kinds: NO_KINDS, records, reads, applyMode: "batch", storageKey, joined: NO_JOINED, recordSlices });
    // Whether each record takes a gesture moves as its first read lands, which moves nothing the shared editing hands on:
    // the queue's is made again as it moves, so a card drawn apart — a memo — reads the rows its change touches then.
    const takes = records.map(record => (editing.available(record.key) ? "1" : "0")).join("");
    const schedule = useMemo((): ScheduleEditing => {
        void takes;
        return { ...editing };
    }, [editing, takes]);
    return useMemo(() => ({ schedule, history: schedule.history, records: byTarget }), [schedule, byTarget]);
}

/**
 * How many steps the cases' session holds done: every step the queue records holds a verdict, so it moves with each —
 * what tells a receipt that its step is still the history's last (R27).
 *
 * @param schedule - The queue's editing
 * @returns The steps done; `undefined` before the session is made
 */
export function casesSteps(schedule: ScheduleEditing): number | undefined {
    return schedule.sessions.find(held => stringEqual(held.kind, CASES))?.session.depth.undo;
}

/** Each payload's cases' codec, made once: the row type its session holds. */
const caseCodecs = new WeakMap<object, RowCodec>();
/** Each version of a case's row the session holds, read once by each payload's `read`: a version is the same object until a gesture replaces it. */
const sessionCases = new WeakMap<object, WeakMap<object, DecisionCase>>();

/**
 * A case as its row stands now (D1): where the cases' session holds its row —
 * a verdict drafted, an Undo taking one back, a Save's verdict until the
 * record reads back past it — that row read as its case, through the
 * payload's `read`; else the case as the list read it. Whether a case waits is
 * whether this one's verdict is none.
 *
 * @param value - The payload
 * @param schedule - The queue's editing
 * @param c - The case as the list read it
 * @returns The case as it stands
 */
export function caseNow(value: DecisionQueueValue, schedule: ScheduleEditing, c: DecisionCase): DecisionCase {
    const version = schedule.sessions.find(held => stringEqual(held.kind, CASES))?.session.entries.get(c.key);
    if (version === undefined) return c;
    const { read, editing } = value.decisions;
    let made = sessionCases.get(read);
    if (made === undefined) { made = new WeakMap(); sessionCases.set(read, made); }
    const held = made.get(version);
    if (held !== undefined) return held;
    const drafted = draftedRow(version);
    if (drafted === undefined) return c;
    let codec = caseCodecs.get(editing);
    if (codec === undefined) { codec = rowCodec(editing.entryType); caseCodecs.set(editing, codec); }
    const now = read(codec.encode(drafted.row), c.key);
    made.set(version, now);
    return now;
}

/**
 * The rows of a record the queue's own drafts hold — verdicts drafted before
 * the one in hand — as their bytes, by their keys' texts: what a preview over
 * the record's rows lays over them. Nothing is read: each is its session's.
 *
 * @param schedule - The queue's editing
 * @param record - The record
 * @returns Each drafted row's bytes, in its key's order; `undefined` for a row a draft removes
 */
export function draftedRows(schedule: ScheduleEditing, record: DecisionRecord): ReadonlyMap<string, Uint8Array | undefined> {
    const codec = rowCodec(record.editing.entryType);
    const session = schedule.sessions.find(held => stringEqual(held.kind, record.key))?.session;
    const rows = new Map<string, Uint8Array | undefined>();
    for (const id of schedule.draftsOf(record.key).keys()) {
        const drafted = draftedRow(session?.entries.get(id));
        rows.set(id, drafted === undefined ? undefined : codec.encode(drafted.row));
    }
    return rows;
}

/** No keys asked. */
const NO_IDS: readonly string[] = [];
/** No rows read. */
const NO_BYTES: readonly (Uint8Array | undefined)[] = [];
/** No rows asked, so none read. */
const NO_ROWS: readonly PagedRow[] = [];
/** A String key's text, which is the key. */
const KEY_AS_TEXT = (id: string): unknown => id;

/** What a read by key needs of a record: its name, which a failure names, and its editing, which holds its key type. */
export type KeyedRecord = Pick<ScheduleEditingRecord, "name" | "editing">;

/** Each key type's reader of a key's text, made the first time the type is seen — East decides which types are the same. */
const keyReaders: { readonly type: EastTypeValue; readonly read: (id: string) => unknown }[] = [];

/**
 * A record's key from its text, as its paged read is asked by it: a String key's text is the key; any other key's is
 * East's text of it, read back.
 *
 * @param record - The record
 * @returns The reader
 * @throws {Error} From the reader, for text that names no key of the record's key type
 */
function keyReaderOf(record: KeyedRecord): (id: string) => unknown {
    const keyType = record.editing.keyType;
    if (keyType.type !== "some" || keyType.value.type === "String") return KEY_AS_TEXT;
    const known = keyReaders.find(reader => sameTypeValue(reader.type, keyType.value));
    if (known !== undefined) return known.read;
    const parse = parseFor(fromEastTypeValue(keyType.value) as EastType);
    const read = (id: string): unknown => {
        const got = parse(id);
        if (!got.success) throw new Error(`${record.name}: the key '${id}' names no key of the record's key type`);
        return got.value;
    };
    keyReaders.push({ type: keyType.value, read });
    return read;
}

/**
 * A record's key from its text, as a read by key asks for it ({@link rowsByKey}): a String key's text is the key; any
 * other key's is East's text of it, read back.
 *
 * @param record - The record: its name and its key type
 * @param id - The key's text
 * @returns The key, an East value of the record's key type
 * @throws {Error} For text that names no key of the record's key type
 */
export function keyOfText(record: KeyedRecord, id: string): unknown {
    return keyReaderOf(record)(id);
}

/**
 * Rows of a record read by key through its paged read of its own entries (its
 * `entries`' `paged`): every key in one request, the paging runtime's
 * `rowsAll` (#1454) — never a request or two a key — each row held there
 * after, so a later read of one by its key asks nothing. Tracked: the read
 * landing runs the evaluation reading it again.
 *
 * @param record - The record: its name and its key type
 * @param paged - The `id` of its paged read
 * @param ids - The rows' keys' texts
 * @returns `none` while the read is in flight; else each row as read, in the order asked — its `row` none for a key the
 *   record does not hold
 * @throws {Error} When the paged read is bound on no page this runtime serves, a key's text names no key, or the read failed
 */
export function rowsByKey(record: KeyedRecord, paged: string, ids: readonly string[]): option<readonly PagedRow[]> {
    if (ids.length === 0) return some(NO_ROWS);
    const source = pagedSourceOf(paged);
    if (source === undefined) throw new Error(`${record.name}: its paged read '${paged}' is bound on no page this runtime serves`);
    return defaultPagedRuntime.rowsAll(source, ids.map(keyReaderOf(record)));
}

/** The bytes of the rows a read by key answered, made once an answer: the paging runtime hands the same answer while it holds. */
const answeredBytes = new WeakMap<readonly PagedRow[], readonly (Uint8Array | undefined)[]>();

/**
 * Rows of a record read by key ({@link rowsByKey}), as their bytes, in the
 * order asked. Tracked.
 *
 * @param record - The record
 * @param paged - The `id` of its paged read
 * @param ids - The rows' keys' texts
 * @returns `none` while the read is in flight; else each row's bytes, `undefined` for a key the record does not hold
 * @throws {Error} When the paged read is bound on no page this runtime serves, a key's text names no key, or the read failed
 */
function storedRows(record: DecisionRecord, paged: string, ids: readonly string[]): option<readonly (Uint8Array | undefined)[]> {
    const read = rowsByKey(record, paged, ids);
    if (read.type !== "some") return none;
    let bytes = answeredBytes.get(read.value);
    if (bytes === undefined) {
        const codec = rowCodec(record.editing.entryType);
        bytes = read.value.map(row => (row.row.type === "some" ? codec.encode(row.row.value) : undefined));
        answeredBytes.set(read.value, bytes);
    }
    return some(bytes);
}

/**
 * Rows of a record as they stand now — drafted, else stored — as their
 * bytes, by their keys' texts in the order given: a drafted row from its
 * session; the stored ones read by key through the record's `entries`, every
 * key in one request ({@link storedRows}) — never a request or two a key —
 * or from the record's snapshot where it is read whole. Tracked: read inside
 * a tracked evaluation.
 *
 * @param schedule - The queue's editing
 * @param record - The record
 * @param ids - The rows' keys' texts
 * @returns `none` while the read is in flight; else each row's bytes by its key's text — `undefined` for a row the record lacks
 * @throws {Error} When the record's paged read is bound on no page this runtime serves, a key's text names no key of
 *   the record's, or the read failed
 */
export function standingRows(schedule: ScheduleEditing, record: DecisionRecord, ids: readonly string[]): option<ReadonlyMap<string, Uint8Array | undefined>> {
    const codec = rowCodec(record.editing.entryType);
    const drafts = schedule.draftsOf(record.key);
    const session = schedule.sessions.find(held => stringEqual(held.kind, record.key))?.session;
    const entries = record.entries;
    // The stored rows read by key: every key the drafts do not hold, in one request.
    const asked = entries.type === "some" ? ids.filter(id => !drafts.has(id)) : NO_IDS;
    let stored = NO_BYTES;
    if (asked.length > 0 && entries.type === "some") {
        const read = storedRows(record, entries.value.paged, asked);
        if (read.type !== "some") return none;
        stored = read.value;
    }
    const rows = new Map<string, Uint8Array | undefined>();
    let next = 0;
    for (const id of ids) {
        if (drafts.has(id)) {
            const drafted = draftedRow(session?.entries.get(id));
            rows.set(id, drafted === undefined ? undefined : codec.encode(drafted.row));
        } else if (entries.type === "some") {
            rows.set(id, stored[next++]);
        } else {
            const held = schedule.held(record.key, id);
            rows.set(id, held === undefined ? undefined : codec.encode(held));
        }
    }
    return some(rows);
}

/** What an option's change leaves: the rows it changes by key — `undefined` for one it deletes — or why it cannot be read now. */
export type AppliedRows =
    | { readonly state: "ready"; readonly rows: ReadonlyMap<string, Uint8Array | undefined>; readonly standing: ReadonlyMap<string, Uint8Array | undefined> }
    | { readonly state: "reading" }
    | { readonly state: "stale" }
    | { readonly state: "none" };

/**
 * The rows an option's change leaves (R23, P21): the target's `apply` over
 * the rows its patch touches as they stand, read at once ({@link standingRows})
 * — tracked, so a read in flight is `reading` until it lands — or `stale` when
 * the change no longer applies to them. Read inside a tracked evaluation.
 *
 * @param schedule - The queue's editing
 * @param target - The target its change's tag names
 * @param record - That target's record
 * @param o - The option
 * @returns The rows, or why there are none to write
 */
export function appliedRows(schedule: ScheduleEditing, target: DecisionTarget | undefined, record: DecisionRecord | undefined, o: DecisionOption): AppliedRows {
    if (target === undefined || record === undefined) return { state: "none" };
    // A record read whole not read yet, or a session that takes no gesture now — its Save under way: nothing to write yet.
    if (!schedule.available(record.key)) return { state: "reading" };
    const keys = target.touched(o.change.patch);
    const read = standingRows(schedule, record, keys);
    if (read.type !== "some") return { state: "reading" };
    const standing = new SortedMap<string, option<Uint8Array>>([], compareString);
    const held = new Map<string, Uint8Array | undefined>();
    for (const key of keys) {
        const row = read.value.get(key);
        standing.set(key, row === undefined ? none : some(row));
        held.set(key, row);
    }
    const applied = target.apply(o.change.patch, standing);
    if (applied.type !== "some") return { state: "stale" };
    const rows = new Map<string, Uint8Array | undefined>();
    for (const [key, row] of applied.value) {
        // A row the change leaves as it stood is no change of it.
        if (blobEqual(row, standing.get(key) ?? none)) continue;
        rows.set(key, row.type === "some" ? row.value : undefined);
    }
    return { state: "ready", rows, standing: held };
}

/** A decision as the person made it: what a step of the history records. */
export interface Decided {
    /** The case. */
    readonly c: DecisionCase;
    /** The option taken — for an override, the one the person started from; `undefined` for a case with none. */
    readonly option: DecisionOption | undefined;
    /** What was decided. */
    readonly verdict: DecisionVerdictWord;
    /** The answer to the option's question, where the verdict's roles hold one. */
    readonly answer?: DecisionAnswerWord | undefined;
    /** An override's reason. */
    readonly reason?: DecisionReasonWord | undefined;
    /** The case's note. */
    readonly note?: string | undefined;
    /** The rows its change writes — Apply's, or an override's own edits — in its target's record; none for a verdict alone. */
    readonly rows?: { readonly record: DecisionRecord; readonly rows: ReadonlyMap<string, Uint8Array | undefined> } | undefined;
}

/**
 * The changes a decision drafts (R23): the verdict, written into the case's
 * own row through the cases' `write` — the fields the verdict's roles map,
 * every other as the row stands, drafted or as read — and each row its
 * change writes, whole, or removed.
 *
 * @param value - The payload
 * @param d - The decision
 * @param at - When it was made
 * @returns The changes, for one step
 */
export function decisionChanges(value: DecisionQueueValue, d: Decided, at: Date): ScheduleChange[] {
    const roles = value.decisions.roles;
    const note = d.note === undefined || d.note.trim() === "" ? none : some(d.note);
    const verdict: DecisionVerdictValue = {
        verdict: variant(d.verdict, null),
        at,
        option: roles.option && d.option !== undefined ? d.option.key : none,
        answer: roles.answer && d.answer !== undefined ? some(variant(d.answer, null)) : none,
        reason: roles.reason && d.reason !== undefined ? some(variant(d.reason, null)) : none,
        note: roles.note ? note : none,
    };
    const changes: ScheduleChange[] = [{ kind: CASES, id: d.c.key, rewrite: row => value.decisions.write(row, verdict) }];
    if (d.rows !== undefined) {
        for (const [id, row] of d.rows.rows) {
            changes.push(row === undefined ? { kind: d.rows.record.key, id, remove: true } : { kind: d.rows.record.key, id, row });
        }
    }
    return changes;
}

/**
 * The target a change's tag names (D6): the first whose tags hold it.
 *
 * @param targets - The payload's targets
 * @param tag - The change's tag
 * @returns Its index among the targets; `-1` for none
 */
export function targetOf(targets: readonly DecisionTarget[], tag: string): number {
    return targets.findIndex(t => t.tags.some(held => stringEqual(held, tag)));
}
