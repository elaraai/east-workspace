/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The DecisionQueue's editing (`Decision Queue Spec.md` Q1, Q2, D3, R23):
 * one history over a session per record the queue writes — the verdicts, and
 * each record a change lands in, one session a record however many targets
 * draw it — through the shared Schedule editing, as the Roster's records are.
 * A verdict is one step across them: the verdict drafted into the verdicts'
 * record through their `write`, and, for Apply, the rows the chosen option's
 * change leaves — the target's `apply` over the rows it touches as they stand,
 * drafted or stored, with Modify's edits in place — each drafted whole into
 * its record. Save sends each record's changes through its patch door as a
 * request of its own.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { BlobType, OptionType, SortedMap, StringType, compareFor, equalFor, none, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import type { DecisionQueuePayloadType, DecisionTargetType, DecisionVerdictType } from "@elaraai/e3-ui/internal";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import type { EditHistory } from "@elaraai/east-ui-components";
import { useScheduleEditing, type ScheduleChange, type ScheduleEditing, type ScheduleEditingRecord, type ScheduleEntryRef } from "../shared/schedule/editing.js";
import { draftedRow, rowCodec } from "../shared/schedule/records.js";
import type { DecisionCase, DecisionOption } from "./layout.js";
import type { DecisionAnswerWord, DecisionReasonWord, DecisionVerdictWord } from "./messages.js";

/** The queue's payload, decoded. */
export type DecisionQueueValue = ValueTypeOf<DecisionQueuePayloadType>;
/** One target, decoded. */
export type DecisionTarget = ValueTypeOf<typeof DecisionTargetType>;
/** A verdict, decoded. */
export type DecisionVerdictValue = ValueTypeOf<typeof DecisionVerdictType>;

/** What a change names the verdicts' record by in the history. */
export const VERDICTS = "decision.verdicts";

const compareString = compareFor(StringType);
const stringEqual = equalFor(StringType);
const blobEqual = equalFor(OptionType(BlobType));
const NO_JOINED: Parameters<typeof useScheduleEditing>[0]["joined"] = [];
const NO_KINDS: Parameters<typeof useScheduleEditing>[0]["kinds"] = [];

/** A record a target draws, as the queue writes it: its session, and the form Modify edits one of its rows in. */
export interface DecisionRecord extends ScheduleEditingRecord {
    /** The form over one of its rows: its kind's or its side's `fields` (D9). */
    readonly fields: readonly FieldSpecValue[];
}

/**
 * The record a target draws, as the queue writes it (D6): its session and its
 * read by key where its kind carries them — a record no builder draws its
 * side's, a builder's the kind its tags patch, the Sheet's the queue's own
 * over its record, whole rows as every other's — keyed in the history by the
 * record's identity, so two targets over one record share its session.
 *
 * @param target - The target
 * @returns Its record; `undefined` for a target whose kind carries no session the queue can write
 */
export function targetRecord(target: DecisionTarget): DecisionRecord | undefined {
    const kind = target.kind;
    const of = (editing: ScheduleEditingRecord["editing"], entries: ScheduleEditingRecord["entries"], fields: readonly FieldSpecValue[]): DecisionRecord =>
        ({ key: `decision.record.${editing.sourceId}`, name: target.name, editing, entries, fields });
    switch (kind.type) {
        case "record": case "zones": case "projection":
            return kind.value.editing.type === "some" ? of(kind.value.editing.value, kind.value.entries, kind.value.fields) : undefined;
        case "roster": {
            const duty = kind.value.roster.duty.kind;
            return of(duty.editing, duty.entries, duty.fields);
        }
        case "plan": case "calendar": {
            const slot = kind.value.event;
            const events = kind.value.events.find(k => stringEqual(k.key, slot));
            return events === undefined ? undefined : of(events.editing, events.entries, events.fields);
        }
        case "allocation": {
            const bins = kind.value.bin.kind;
            return of(bins.editing, bins.entries, bins.fields);
        }
        case "sheet":
            return of(kind.value.editing, kind.value.entries, []);
    }
}

/** The queue's editing: its history over the verdicts and the targets' records, and how a verdict is made of a decision. */
export interface DecisionEditing {
    /** The shared Schedule editing over the records: how a step is recorded, and what each record holds. */
    readonly schedule: ScheduleEditing;
    /** The one history over them. */
    readonly history: EditHistory<ScheduleEntryRef>;
    /** Each target's record, in the targets' order: `undefined` for a target whose kind carries none. */
    readonly records: readonly (DecisionRecord | undefined)[];
}

/**
 * The queue's sessions (see the module docs).
 *
 * @param value - The payload
 * @param storageKey - The queue's key: its sessions and their history are kept under it, whatever the narrowing or a remount
 * @returns The editing
 */
export function useDecisionEditing(value: DecisionQueueValue, storageKey: string): DecisionEditing {
    const { verdicts, targets } = value;
    const { records, byTarget } = useMemo(() => {
        const byTarget = targets.map(targetRecord);
        // One session a record, however many targets draw it.
        const distinct: DecisionRecord[] = [];
        for (const record of byTarget) if (record !== undefined && !distinct.some(held => stringEqual(held.key, record.key))) distinct.push(record);
        const records: ScheduleEditingRecord[] = [{ key: VERDICTS, name: "Verdicts", editing: verdicts.editing, entries: some(verdicts.entries) }, ...distinct];
        return { records, byTarget };
    }, [verdicts, targets]);
    const schedule = useScheduleEditing({ kinds: NO_KINDS, records, applyMode: "batch", storageKey, joined: NO_JOINED });
    return useMemo(() => ({ schedule, history: schedule.history, records: byTarget }), [schedule, byTarget]);
}

/**
 * How the verdicts' session holds a case's verdict (D1): drafted — the case is decided, its verdict unsaved — or
 * removed — an Undo past its Save took a saved verdict back, so the case waits again.
 */
export type VerdictDraft = "drafted" | "removed";

/**
 * How a case's verdict is drafted (D1, see {@link VerdictDraft}).
 *
 * @param schedule - The queue's editing
 * @param key - The case's key
 * @returns How it is drafted; `undefined` for no draft — the case waits unless its verdict reads back as saved
 */
export function verdictDraft(schedule: ScheduleEditing, key: string): VerdictDraft | undefined {
    if (!schedule.draftsOf(VERDICTS).has(key)) return undefined;
    const session = schedule.sessions.find(held => stringEqual(held.kind, VERDICTS))?.session;
    return draftedRow(session?.entries.get(key)) === undefined ? "removed" : "drafted";
}

/**
 * How many steps the verdicts' session holds done: every step the queue records holds a verdict, so it moves with
 * each — what tells a receipt, or the batch banner, that its step is still the history's last.
 *
 * @param schedule - The queue's editing
 * @returns The steps done; `undefined` before the session is made
 */
export function verdictSteps(schedule: ScheduleEditing): number | undefined {
    return schedule.sessions.find(held => stringEqual(held.kind, VERDICTS))?.session.depth.undo;
}

/**
 * A row of a record as it stands now — drafted, else stored — as its bytes:
 * read by its key through the record's `entries`, tracked, or from the
 * record's snapshot where it is read whole.
 *
 * @param schedule - The queue's editing
 * @param record - The record
 * @param id - The row's key's text
 * @returns `none` while its read is in flight; `some(none)` for a row the record lacks; else its bytes
 */
export function standingRow(schedule: ScheduleEditing, record: DecisionRecord, id: string): option<option<Uint8Array>> {
    const codec = rowCodec(record.editing.entryType);
    const session = schedule.sessions.find(held => stringEqual(held.kind, record.key))?.session;
    if (schedule.draftsOf(record.key).has(id)) {
        const drafted = draftedRow(session?.entries.get(id));
        return some(drafted === undefined ? none : some(codec.encode(drafted.row)));
    }
    if (record.entries.type === "some") return record.entries.value.entry(id);
    const held = schedule.held(record.key, id);
    return some(held === undefined ? none : some(codec.encode(held)));
}

/** What an option's change leaves: the rows it changes by key — `undefined` for one it deletes — or why it cannot be read now. */
export type AppliedRows =
    | { readonly state: "ready"; readonly rows: ReadonlyMap<string, Uint8Array | undefined>; readonly standing: ReadonlyMap<string, Uint8Array | undefined> }
    | { readonly state: "reading" }
    | { readonly state: "stale" }
    | { readonly state: "none" };

/** The rows earlier changes of a batch leave, by their record's key then the row's: `undefined` for one removed. */
export type EarlierRows = ReadonlyMap<string, ReadonlyMap<string, Uint8Array | undefined>>;

/**
 * The rows an option's change leaves (R23, P21): the target's `apply` over
 * the rows its patch touches as they stand — tracked, so a read in flight is
 * `reading` until it lands — or `stale` when the change no longer applies to
 * them. Read inside a tracked evaluation.
 *
 * @param schedule - The queue's editing
 * @param target - The target its change's tag names
 * @param record - That target's record
 * @param o - The option
 * @param earlier - The rows the changes before it in a batch leave ({@link appliedInTurn}): it applies over them
 * @returns The rows, or why there are none to write
 */
export function appliedRows(schedule: ScheduleEditing, target: DecisionTarget | undefined, record: DecisionRecord | undefined, o: DecisionOption,
    earlier?: EarlierRows): AppliedRows {
    if (target === undefined || record === undefined) return { state: "none" };
    // A record read whole not read yet, or a session that takes no gesture now — its Save under way: nothing to write yet.
    if (!schedule.available(record.key)) return { state: "reading" };
    const keys = target.touched(o.change.patch);
    const before = earlier?.get(record.key);
    const standing = new SortedMap<string, option<Uint8Array>>([], compareString);
    const held = new Map<string, Uint8Array | undefined>();
    let reading = false;
    for (const key of keys) {
        // A row an earlier change of the batch leaves stands as it leaves it.
        const left = before?.has(key) === true ? before.get(key) : undefined;
        const row = before?.has(key) === true ? some(left === undefined ? none : some(left)) : standingRow(schedule, record, key);
        if (row.type !== "some") { reading = true; continue; }
        standing.set(key, row.value);
        held.set(key, row.value.type === "some" ? row.value.value : undefined);
    }
    if (reading) return { state: "reading" };
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

/** One option of a batch, and the target and record its change lands in. */
export interface AppliedItem {
    /** The target its change's tag names. */
    readonly target: DecisionTarget | undefined;
    /** That target's record. */
    readonly record: DecisionRecord | undefined;
    /** The option. */
    readonly option: DecisionOption;
}

/**
 * The rows each option of a batch leaves, in turn (R28): each over the rows as they stand with the rows the options
 * before it leave in place, so two changes of one row compose in the batch's order, as its one step records them.
 * Read inside a tracked evaluation.
 *
 * @param schedule - The queue's editing
 * @param items - The batch's options, in its order
 * @returns What each leaves, in the same order
 */
export function appliedInTurn(schedule: ScheduleEditing, items: readonly AppliedItem[]): AppliedRows[] {
    const earlier = new Map<string, Map<string, Uint8Array | undefined>>();
    return items.map(item => {
        const applied = appliedRows(schedule, item.target, item.record, item.option, earlier);
        if (applied.state === "ready" && item.record !== undefined) {
            let rows = earlier.get(item.record.key);
            if (rows === undefined) { rows = new Map(); earlier.set(item.record.key, rows); }
            for (const [key, row] of applied.rows) rows.set(key, row);
        }
        return applied;
    });
}

/** A decision as the person made it: what a step of the history records. */
export interface Decided {
    /** The case. */
    readonly c: DecisionCase;
    /** The option taken — for an override, the one the person started from; `undefined` for a case with none. */
    readonly option: DecisionOption | undefined;
    /** What was decided. */
    readonly verdict: DecisionVerdictWord;
    /** The answer to the option's question, where the verdicts' roles hold one. */
    readonly answer?: DecisionAnswerWord | undefined;
    /** An override's reason. */
    readonly reason?: DecisionReasonWord | undefined;
    /** The case's note. */
    readonly note?: string | undefined;
    /** The rows its change writes — Apply's, or an override's own edits — in its target's record; none for a verdict alone. */
    readonly rows?: { readonly record: DecisionRecord; readonly rows: ReadonlyMap<string, Uint8Array | undefined> } | undefined;
}

/**
 * The changes a decision drafts (R23): the verdict, written into a new row of
 * the verdicts' record under the case's key through their `write` — the
 * fields their roles map, every other as a new row has it — and each row its
 * change writes, whole, or removed.
 *
 * @param value - The payload
 * @param d - The decision
 * @param at - When it was made
 * @returns The changes, for one step
 */
export function decisionChanges(value: DecisionQueueValue, d: Decided, at: Date): ScheduleChange[] {
    const roles = value.verdicts.roles;
    const note = d.note === undefined || d.note.trim() === "" ? none : some(d.note);
    const verdict: DecisionVerdictValue = {
        verdict: variant(d.verdict, null),
        at,
        option: roles.option && d.option !== undefined ? d.option.key : none,
        answer: roles.answer && d.answer !== undefined ? some(variant(d.answer, null)) : none,
        reason: roles.reason && d.reason !== undefined ? some(variant(d.reason, null)) : none,
        note: roles.note ? note : none,
    };
    const changes: ScheduleChange[] = [{ kind: VERDICTS, id: d.c.key, row: value.verdicts.write(none, verdict), created: true }];
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
