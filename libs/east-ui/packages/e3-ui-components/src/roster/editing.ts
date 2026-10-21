/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's editing (#1369, `Builder Interfaces Spec.md` §7): one history
 * over a session per record it writes — the duties (the duty kind's session,
 * read by key through its `entries` when it is given them), the weeks (the
 * periods') and the targets — through the shared Schedule editing, so a
 * gesture across them is one step and Save sends each record's changes as its
 * own request. Drafts of every week stay in their sessions, as the Calendar's
 * do: navigating, the rail and a remount keep them, and Save includes them.
 * The week's own reads of each record serve a gesture's original and a Save's
 * confirmation, at the revision the Save committed; a row they do not hold is
 * read by its key.
 *
 * @packageDocumentation
 */

import { useMemo, useRef } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import type { EditHistory, EditSession, EntryVersion } from "@elaraai/east-ui-components";
import { useScheduleEditing, type ScheduleEditing, type ScheduleEditingRecord, type ScheduleEntryRef, type ScheduleRowRead } from "../shared/schedule/editing.js";
import { draftedRow, heldInWindow, keptAtRevision, periodRowRead, rowCodec } from "../shared/schedule/records.js";
import { rosterDomain, weekKey, weekSpan, weekWindow, type DraftedDuty, type RosterValue, type StoredTarget } from "./model.js";

/** What a change names the weeks' record by in the history: no duty kind's slot. */
export const PERIODS = "roster.periods";
/** What a change names the targets' record by in the history. */
export const TARGETS = "roster.targets";

/** The Roster's editing: its history, and every draft of each record, decoded once. */
export interface RosterEditing {
    /** The shared Schedule editing over the three records: how a gesture is recorded, and what each record holds. */
    readonly schedule: ScheduleEditing;
    /** The one history over them. */
    readonly history: EditHistory<ScheduleEntryRef>;
    /** The duty kind's slot: what a change names the duties by. */
    readonly duty: string;
    /** Every drafted duty of every week, by key: its bytes, its roles and its row, or `undefined` for one removed. */
    readonly duties: ReadonlyMap<string, DraftedDuty | undefined>;
    /** Every drafted target, by key: its bytes and its roles, or `undefined` for one removed. */
    readonly targets: ReadonlyMap<string, StoredTarget | undefined>;
    /** Every drafted week's row, by its key's text: its bytes, or `undefined` for one removed. */
    readonly periods: ReadonlyMap<string, Uint8Array | undefined>;
}

const NO_JOINED: Parameters<typeof useScheduleEditing>[0]["joined"] = [];

/**
 * The Roster's sessions over its records, and their drafts (see the module docs).
 *
 * @param value - The payload
 * @param storageKey - The Roster's key: its sessions and their history are kept under it
 * @param start - The week shown: the windows the Roster reads its records over
 * @param recordSlices - The slice's parts over the records it writes: each Save notice counts what leaves its own
 * @returns The editing
 */
export function useRosterEditing(value: RosterValue, storageKey: string, start: Date, recordSlices: readonly ValueTypeOf<RecordSliceBindType>[]): RosterEditing {
    const domain = rosterDomain(value.duty.rowType);
    const kinds = useMemo(() => [value.duty.kind], [value.duty.kind]);
    const records = useMemo((): ScheduleEditingRecord[] => [
        ...(value.periods.type === "some" ? [{ key: PERIODS, name: value.periods.value.every.type === "week" ? "Weeks" : "Days",
            editing: value.periods.value.editing, entries: value.periods.value.entries }] : []),
        ...(value.targets.type === "some" ? [{ key: TARGETS, name: "Targets", editing: value.targets.value.editing, entries: value.targets.value.entries }] : []),
    ], [value.periods, value.targets]);
    const epoch = start.getTime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const range = useMemo(() => weekWindow(start), [epoch]);
    // Each record's rows where the week's own reads hold them — the duties' window, the week's own row and its targets:
    // a gesture's original, and what a Save confirms its entries by at the revision it committed.
    const reads = useMemo((): Record<string, ScheduleRowRead> => {
        const window = weekWindow(start), week = weekSpan(start), id = weekKey(start);
        const duties = keptAtRevision(value.duty.kind.entries, () => value.duty.rows(window.from, window.to));
        const out: Record<string, ScheduleRowRead> = { [value.duty.kind.key]: key => heldInWindow(duties(), key) };
        // The week's own row, by its start: the week's read holds none of another week's.
        if (value.periods.type === "some") out[PERIODS] = periodRowRead(value.periods.value, week.from, week.to, id);
        if (value.targets.type === "some") {
            const targets = value.targets.value;
            const read = keptAtRevision(targets.entries, () => targets.rows(week.from, week.to));
            out[TARGETS] = key => heldInWindow(read(), key);
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value.duty, value.periods, value.targets, epoch]);
    const schedule = useScheduleEditing({ kinds, records, reads, applyMode: "batch", storageKey, joined: NO_JOINED, range, recordSlices });
    const duty = value.duty.kind.key;
    const sessionOf = (key: string): EditSession<ScheduleEntryRef> | undefined => schedule.sessions.find(held => held.kind === key)?.session;
    // Each draft decoded once: a session keeps an entry's version the same object until a gesture replaces it.
    const dutyCache = useRef(new WeakMap<EntryVersion<ScheduleEntryRef>, DraftedDuty>());
    const targetCache = useRef(new WeakMap<EntryVersion<ScheduleEntryRef>, StoredTarget>());
    const periodCache = useRef(new WeakMap<EntryVersion<ScheduleEntryRef>, Uint8Array>());
    const drafts = schedule.drafts;
    const duties = useMemo(() => {
        const session = sessionOf(duty);
        const out = new Map<string, DraftedDuty | undefined>();
        for (const id of schedule.draftsOf(duty).keys()) {
            const entry = session?.entries.get(id);
            const drafted = draftedRow(entry);
            if (entry === undefined || drafted === undefined) { out.set(id, undefined); continue; }
            let held = dutyCache.current.get(entry);
            if (held === undefined) {
                const bytes = domain.encodeRow(drafted.row);
                held = { bytes, roles: value.duty.read(bytes, id), row: drafted.row };
                dutyCache.current.set(entry, held);
            }
            out.set(id, held);
        }
        return out;
        // The drafts move with every gesture: their bytes say when.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drafts, duty, domain, value.duty]);
    const targets = useMemo(() => {
        const out = new Map<string, StoredTarget | undefined>();
        if (value.targets.type !== "some") return out;
        const kind = value.targets.value;
        const codec = rowCodec(kind.rowType);
        const session = sessionOf(TARGETS);
        for (const id of schedule.draftsOf(TARGETS).keys()) {
            const entry = session?.entries.get(id);
            const drafted = draftedRow(entry);
            if (entry === undefined || drafted === undefined) { out.set(id, undefined); continue; }
            let held = targetCache.current.get(entry);
            if (held === undefined) {
                const bytes = codec.encode(drafted.row);
                held = { bytes, roles: kind.read(bytes) };
                targetCache.current.set(entry, held);
            }
            out.set(id, held);
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drafts, value.targets]);
    const periods = useMemo(() => {
        const out = new Map<string, Uint8Array | undefined>();
        if (value.periods.type !== "some") return out;
        const codec = rowCodec(value.periods.value.rowType);
        const session = sessionOf(PERIODS);
        for (const id of schedule.draftsOf(PERIODS).keys()) {
            const entry = session?.entries.get(id);
            const drafted = draftedRow(entry);
            if (entry === undefined || drafted === undefined) { out.set(id, undefined); continue; }
            let held = periodCache.current.get(entry);
            if (held === undefined) { held = codec.encode(drafted.row); periodCache.current.set(entry, held); }
            out.set(id, held);
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drafts, value.periods]);
    return useMemo(() => ({ schedule, history: schedule.history, duty, duties, targets, periods }), [schedule, duty, duties, targets, periods]);
}
