/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's reads of the app's records (#1372, `Builder Interfaces
 * Spec.md` §7.5, §9), in a component of its own, as the Roster's week is
 * (#1343): the day's bins through the bin kind's `rows` — over the day, the
 * range the board's navigation writes into the bins' source of the slice — the
 * day's own row through the periods' `rows`, and the open picker's month's
 * rows through the same, as one span. What it reads is kept by its bytes: a
 * row read again as it was keeps its decoded row, so a render never decodes it
 * again, and the frame is handed what it reads only when that moves. While the
 * day's read is in flight the frame is covered (A80); a day it has not read is
 * never drawn as empty.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { BlobType, DateTimeType, DictType, SortedMap, equalFor } from "@elaraai/east";
import { SchedulePeriodStatusType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { DAY, allocationDomain, compareDate, compareString, type AllocationValue, type Day, type StoredBin } from "./model.js";

const sameBytes = equalFor(BlobType);
const samePicker = equalFor(DictType(DateTimeType, SchedulePeriodStatusType));

/** A day's status, as its period's row says it. */
type Status = Day["status"];

/** What the board has read of its records for a day. */
export interface AllocationData {
    /** The day it is of. */
    readonly day: Date;
    /** The day's stored bins, by key: what its window read. */
    readonly bins: ReadonlyMap<string, StoredBin>;
    /** The day's own row's bytes, its period's; `undefined` for a day with no row, or a board with no periods. */
    readonly period: Uint8Array | undefined;
    /** The open picker's days' statuses, by day: a day with no row is not among them. */
    readonly picker: SortedMap<Date, Status>;
    /** Whether a read the day needs — its bins or its row — is in flight. */
    readonly loading: boolean;
    /** Whether a complete read of the day has landed. */
    readonly ready: boolean;
    /** Why the latest read failed. */
    readonly error: string | undefined;
}

const NO_BINS: ReadonlyMap<string, StoredBin> = new Map();
const NO_STATUSES = new SortedMap<Date, Status>([], compareDate);

/**
 * The frame's data before its reader first reports: nothing held, a read in flight.
 *
 * @param day - The day the frame shows
 * @returns The state
 */
export function initialAllocationData(day: Date): AllocationData {
    return { day, bins: NO_BINS, period: undefined, picker: NO_STATUSES, loading: true, ready: false, error: undefined };
}

/** Bins read again, each kept as it was where its bytes are: the same object, its row not decoded again. */
function keptBins(read: ReadonlyMap<string, { roles: StoredBin["roles"]; row: Uint8Array }>, held: ReadonlyMap<string, StoredBin> | undefined,
    decode: (bytes: Uint8Array) => unknown): ReadonlyMap<string, StoredBin> {
    const out = new SortedMap<string, StoredBin>([], compareString);
    let same = held !== undefined && held.size === read.size;
    for (const [key, entry] of read) {
        const was = held?.get(key);
        if (was !== undefined && sameBytes(was.bytes, entry.row)) { out.set(key, was); continue; }
        same = false;
        out.set(key, { roles: entry.roles, bytes: entry.row, row: decode(entry.row) });
    }
    return same && held !== undefined ? held : out;
}

/**
 * Reads the day (see the module docs).
 *
 * @param value - The payload
 * @param day - The plan day, at UTC midnight
 * @param pickerDays - The open picker's days, in order
 * @returns What the board has read of the day
 */
export function useAllocationData(value: AllocationValue, day: Date, pickerDays: readonly Date[]): AllocationData {
    // What was read last, kept by its bytes across reads.
    const held = useRef<{ bins?: ReadonlyMap<string, StoredBin>; picker?: SortedMap<Date, Status> }>({});
    const read = useCallback(() => {
        const domain = allocationDomain(value.bin.rowType);
        let loading = false;
        const next = new Date(day.getTime() + DAY);
        const rows = value.bin.rows(day, next);
        let bins: ReadonlyMap<string, StoredBin> | undefined;
        if (rows.type === "some") bins = keptBins(rows.value, held.current.bins, domain.decodeRow);
        else loading = true;
        // The day's own row, by its start; and the open picker's days, one span from its first day to the day after its last.
        let period: Uint8Array | undefined;
        let picker = NO_STATUSES;
        if (value.periods.type === "some") {
            const periods = value.periods.value;
            const got = periods.rows(day, next);
            if (got.type === "some") period = got.value.get(day);
            else loading = true;
            const first = pickerDays[0], last = pickerDays[pickerDays.length - 1];
            if (first !== undefined && last !== undefined) {
                const span = periods.rows(first, new Date(last.getTime() + DAY));
                if (span.type === "some") {
                    const statuses = new SortedMap([...span.value].map(([at, bytes]) => [at, periods.status(bytes)] as const), compareDate);
                    const was = held.current.picker;
                    picker = was !== undefined && samePicker(was, statuses) ? was : statuses;
                }
            }
        }
        return { bins, period, picker, loading };
    }, [value, day, pickerDays]);
    const { result } = useTrackedEvaluation(read);
    // The last complete read of a day: a newer one in flight keeps it, so a page landing redraws nothing until the read is whole.
    const complete = useRef<AllocationData | undefined>(undefined);
    if (result.ok) {
        const got = result.value;
        held.current = { ...(got.bins === undefined ? {} : { bins: got.bins }), ...(Object.is(got.picker, NO_STATUSES) ? {} : { picker: got.picker }) };
        const was = complete.current;
        if (!got.loading && got.bins !== undefined && (was === undefined || compareDate(was.day, day) !== 0 || !Object.is(was.bins, got.bins)
            || !Object.is(was.picker, got.picker) || (was.period === undefined ? got.period !== undefined : got.period === undefined || !sameBytes(was.period, got.period)))) {
            complete.current = { day, bins: got.bins, period: got.period, picker: got.picker, loading: false, ready: true, error: undefined };
        }
    }
    const last = complete.current;
    // A day moved to holds nothing of the day before it: its read is in flight until it lands.
    const current = last !== undefined && compareDate(last.day, day) === 0 ? last : undefined;
    const loading = result.ok ? result.value.loading || current === undefined : false;
    const error = result.ok ? undefined : result.error instanceof Error ? result.error.message : String(result.error);
    return useMemo(() => current === undefined ? { ...initialAllocationData(day), loading, error }
        : current.loading === loading && current.error === error ? current : { ...current, loading, error }, [current, day, loading, error]);
}

/**
 * The day's reads, in a component of its own (#1343): each page and search
 * that lands re-runs it alone, and it hands the frame what it read only when
 * what the frame shows moves.
 *
 * @param props - The payload, the day, the open picker's days, and where the data goes
 * @returns Nothing: it reads
 */
export function AllocationDataReader({ value, day, pickerDays, onData }: {
    value: AllocationValue; day: Date; pickerDays: readonly Date[]; onData: (data: AllocationData) => void;
}): null {
    const data = useAllocationData(value, day, pickerDays);
    const reported = useRef<AllocationData | undefined>(undefined);
    useLayoutEffect(() => {
        if (Object.is(reported.current, data)) return;
        reported.current = data;
        onData(data);
    });
    return null;
}
