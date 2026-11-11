/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's editing (#1372, `Builder Interfaces Spec.md` §7): one
 * history over a session per record it writes — the bins (the bin kind's
 * session, read by key through its `entries` when it is given them) and the
 * periods, its days or its weeks (#1550) — through the shared Schedule
 * editing, as the Roster's is: a gesture is one step, and Save sends each
 * record's changes as its own request. Drafts of every day stay in their sessions: navigating, the rail and
 * a remount keep them, and Save includes them. The day's own reads of each
 * record serve a gesture's original and a Save's confirmation, at the revision
 * the Save committed; a row they do not hold is read by its key.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import type { FieldSpecValue, RecordSliceBindType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined, type EditHistory, type EditSession, type EntryVersion } from "@elaraai/east-ui-components";
import { isBounded } from "../shared/bounds.js";
import {
    useScheduleEditing, type ScheduleEditing, type ScheduleEditingRecord, type ScheduleEntryRef, type ScheduleRowRead, type ScheduleStandingRows,
} from "../shared/schedule/editing.js";
import { draftedRow, heldInWindow, keptAtRevision, periodRowRead, rowCodec } from "../shared/schedule/records.js";
import { DAY, allocationDomain, dayKey, periodSpan, type AllocationValue, type DraftedBin, type StoredBin } from "./model.js";

/** What a change names the periods' record by in the history — its days', or its weeks' (#1550): no bin kind's slot. */
export const PERIODS = "allocation.periods";

const keyEqual = equalFor(StringType);

/**
 * The fields of the bin kind's form a bin's numbers are held to the bounds of (#1585), from its row: every bounded one,
 * but a reservation's quantity — it holds none until an arrival is booked into it, and is checked once that makes it a
 * bin. One rule for what holds Save, what wears the warn ring and what Issues lists out of range.
 *
 * @param bin - The bin kind
 * @returns A row's bounded fields
 */
export function binBounds(bin: AllocationValue["bin"]): (row: unknown) => readonly FieldSpecValue[] {
    const bounded = bin.kind.fields.filter(isBounded);
    const quantity = getSomeorUndefined(bin.kind.schedule.quantity);
    const reserved = quantity === undefined ? bounded : bounded.filter(spec => !(spec.path.length === 1 && keyEqual(spec.path[0]!, quantity)));
    if (reserved.length === bounded.length) return () => bounded;
    const { encodeRow } = allocationDomain(bin.rowType);
    return row => bin.read(encodeRow(row)).arrival.type === "none" ? reserved : bounded;
}

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
    /** Every drafted period's row — a day's, or a week's (#1550) — by its key's text: its bytes, or `undefined` for one removed. */
    readonly periods: ReadonlyMap<string, Uint8Array | undefined>;
    /**
     * Where the board says what it draws of each record now: a gesture's original while the record's revision now is
     * read — after a Save, or another session's — so a gesture on what the board shows is taken at once.
     */
    readonly standing: RefObject<ScheduleStandingRows | undefined>;
}

const NO_JOINED: Parameters<typeof useScheduleEditing>[0]["joined"] = [];

/**
 * Says what the board draws of each record now ({@link AllocationEditing.standing}): the day's bins, and the own row
 * of the period holding the day — as the frame holds them, at whatever revision they were read. None while the board
 * draws no read of the day in view. Said as the frame commits, so a gesture reads what the page shows.
 *
 * @param editing - The board's editing; none for a board read only
 * @param bins - The bins the frame draws, while its read is the day's own
 * @param period - The period's own row as the frame holds it
 * @param periodId - The period's key's text
 */
export function useAllocationStanding(editing: AllocationEditing | undefined, bins: ReadonlyMap<string, StoredBin> | undefined, period: Uint8Array | undefined, periodId: string): void {
    const standing = editing?.standing;
    const bin = editing?.bin;
    useLayoutEffect(() => {
        if (standing === undefined || bin === undefined) return undefined;
        standing.current = bins === undefined ? undefined : {
            [bin]: id => bins.get(id)?.bytes,
            [PERIODS]: id => (keyEqual(id, periodId) ? period : undefined),
        };
        return () => { standing.current = undefined; };
    }, [standing, bin, bins, period, periodId]);
}

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
        ? [{ key: PERIODS, name: value.periods.value.every.type === "week" ? "Weeks" : "Days", editing: value.periods.value.editing, entries: value.periods.value.entries }]
        : [], [value.periods]);
    const epoch = day.getTime();
    const range = useMemo(() => ({ from: new Date(epoch), to: new Date(epoch + DAY) }), [epoch]);
    // The period holding the day — the day, or its week (#1550): its own row is what the day's reads hold of the periods.
    const own = periodSpan(value, day), ownFrom = own.from.getTime(), ownTo = own.to.getTime();
    // Each record's rows where the day's own reads hold them — the bins' window and its period's own row: a gesture's original,
    // and what a Save confirms its entries by at the revision it committed.
    const reads = useMemo((): Record<string, ScheduleRowRead> => {
        const from = new Date(epoch), to = new Date(epoch + DAY);
        const bins = keptAtRevision(value.bin.kind.entries, () => value.bin.rows(from, to));
        const out: Record<string, ScheduleRowRead> = { [value.bin.kind.key]: key => heldInWindow(bins(), key) };
        // The period's own row, by its start: the day's read holds none of another period's.
        if (value.periods.type === "some") out[PERIODS] = periodRowRead(value.periods.value, new Date(ownFrom), new Date(ownTo), dayKey(new Date(ownFrom)));
        return out;
    }, [value.bin, value.periods, epoch, ownFrom, ownTo]);
    // A reservation holds no quantity yet: none of its quantity's bounds hold its Save (#1585).
    const boundsOf = useMemo(() => ({ [value.bin.kind.key]: binBounds(value.bin) }), [value.bin]);
    // A bin's quantity and its split across resources change together: one conflict, under the board's word for a quantity.
    const standing = useRef<ScheduleStandingRows | undefined>(undefined);
    const schedule = useScheduleEditing({ kinds, records, reads, standing, storageKey, joined: NO_JOINED, range, recordSlices, quantityLabel: value.labels.quantity, boundsOf });
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
    return useMemo(() => ({ schedule, history: schedule.history, bin, bins, periods, standing }), [schedule, bin, bins, periods]);
}
