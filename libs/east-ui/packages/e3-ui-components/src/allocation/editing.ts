/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's editing (#1372, `Builder Interfaces Spec.md` §7): one
 * history over a session per record it writes — the bins (the bin kind's
 * session, read by key through its `entries` when it is given them) and the
 * days (the periods') — through the shared Schedule editing, as the Roster's
 * is: a gesture is one step, and Save sends each record's changes as its own
 * request. Drafts of every day stay in their sessions: navigating, the rail and
 * a remount keep them, and Save includes them. The day's own reads of each
 * record serve a gesture's original and a Save's confirmation, at the revision
 * the Save committed; a row they do not hold is read by its key.
 *
 * @packageDocumentation
 */

import { useMemo, useRef } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import type { EditHistory, EditSession, EntryVersion } from "@elaraai/east-ui-components";
import { useScheduleEditing, type ScheduleEditing, type ScheduleEditingRecord, type ScheduleEntryRef, type ScheduleRowRead } from "../shared/schedule/editing.js";
import { draftedRow, heldInWindow, keptAtRevision, periodRowRead, rowCodec } from "../shared/schedule/records.js";
import { DAY, allocationDomain, dayKey, type AllocationValue, type DraftedBin } from "./model.js";

/** What a change names the days' record by in the history: no bin kind's slot. */
export const PERIODS = "allocation.periods";

/** The Allocation's editing: its history, and every draft of each record, decoded once. */
export interface AllocationEditing {
    /** The shared Schedule editing over the two records: how a gesture is recorded, and what each record holds. */
    readonly schedule: ScheduleEditing;
    /** The one history over them. */
    readonly history: EditHistory<ScheduleEntryRef>;
    /** The bin kind's slot: what a change names the bins by. */
    readonly bin: string;
    /** Every drafted bin of every day, by key: its bytes, its roles and its row, or `undefined` for one removed. */
    readonly bins: ReadonlyMap<string, DraftedBin | undefined>;
    /** Every drafted day's row, by its key's text: its bytes, or `undefined` for one removed. */
    readonly periods: ReadonlyMap<string, Uint8Array | undefined>;
}

const NO_JOINED: Parameters<typeof useScheduleEditing>[0]["joined"] = [];

/**
 * The Allocation's sessions over its records, and their drafts (see the module docs).
 *
 * @param value - The payload
 * @param storageKey - The board's key: its sessions and their history are kept under it
 * @param day - The plan day: the window the board reads its records over
 * @param recordSlices - The slice's part over the bins: its Save notice counts what leaves it
 * @returns The editing
 */
export function useAllocationEditing(value: AllocationValue, storageKey: string, day: Date, recordSlices: readonly ValueTypeOf<RecordSliceBindType>[]): AllocationEditing {
    const domain = allocationDomain(value.bin.rowType);
    const kinds = useMemo(() => [value.bin.kind], [value.bin.kind]);
    const records = useMemo((): ScheduleEditingRecord[] => value.periods.type === "some"
        ? [{ key: PERIODS, name: "Days", editing: value.periods.value.editing, entries: value.periods.value.entries }] : [], [value.periods]);
    const epoch = day.getTime();
    const range = useMemo(() => ({ from: new Date(epoch), to: new Date(epoch + DAY) }), [epoch]);
    // Each record's rows where the day's own reads hold them — the bins' window and the day's own row: a gesture's original, and
    // what a Save confirms its entries by at the revision it committed.
    const reads = useMemo((): Record<string, ScheduleRowRead> => {
        const from = new Date(epoch), to = new Date(epoch + DAY);
        const bins = keptAtRevision(value.bin.kind.entries, () => value.bin.rows(from, to));
        const out: Record<string, ScheduleRowRead> = { [value.bin.kind.key]: key => heldInWindow(bins(), key) };
        // The day's own row, by its start: the day's read holds none of another day's.
        if (value.periods.type === "some") out[PERIODS] = periodRowRead(value.periods.value, from, to, dayKey(from));
        return out;
    }, [value.bin, value.periods, epoch]);
    const schedule = useScheduleEditing({ kinds, records, reads, applyMode: "batch", storageKey, joined: NO_JOINED, range, recordSlices });
    const bin = value.bin.kind.key;
    const sessionOf = (key: string): EditSession<ScheduleEntryRef> | undefined => schedule.sessions.find(held => held.kind === key)?.session;
    // Each draft decoded once: a session keeps an entry's version the same object until a gesture replaces it.
    const binCache = useRef(new WeakMap<EntryVersion<ScheduleEntryRef>, DraftedBin>());
    const periodCache = useRef(new WeakMap<EntryVersion<ScheduleEntryRef>, Uint8Array>());
    const drafts = schedule.drafts;
    const bins = useMemo(() => {
        const session = sessionOf(bin);
        const out = new Map<string, DraftedBin | undefined>();
        for (const id of schedule.draftsOf(bin).keys()) {
            const entry = session?.entries.get(id);
            const drafted = draftedRow(entry);
            if (entry === undefined || drafted === undefined) { out.set(id, undefined); continue; }
            let held = binCache.current.get(entry);
            if (held === undefined) {
                const bytes = domain.encodeRow(drafted.row);
                held = { bytes, roles: value.bin.read(bytes), row: drafted.row };
                binCache.current.set(entry, held);
            }
            out.set(id, held);
        }
        return out;
        // The drafts move with every gesture: their bytes say when.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drafts, bin, domain, value.bin]);
    const periods = useMemo(() => {
        const out = new Map<string, Uint8Array | undefined>();
        if (value.periods.type !== "some") return out;
        const encode = rowCodec(value.periods.value.rowType).encode;
        const session = sessionOf(PERIODS);
        for (const id of schedule.draftsOf(PERIODS).keys()) {
            const entry = session?.entries.get(id);
            const drafted = draftedRow(entry);
            if (entry === undefined || drafted === undefined) { out.set(id, undefined); continue; }
            let held = periodCache.current.get(entry);
            if (held === undefined) { held = encode(drafted.row); periodCache.current.set(entry, held); }
            out.set(id, held);
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drafts, value.periods]);
    return useMemo(() => ({ schedule, history: schedule.history, bin, bins, periods }), [schedule, bin, bins, periods]);
}
