/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's reads of the app's records (#1369, `Builder Interfaces Spec.md`
 * §7.5, §9), in a component of its own, as the Calendar's window is (#1343):
 * the week's duties through the duty kind's `rows` — over the week and the
 * twelve hours either side a duty's start may stand from its shift's
 * (`weekWindow`), and the week before's while the week holds none, which Copy
 * previous week reads — the week's own row through the periods' `rows`, the
 * open picker's weeks' through the same, and the week's targets through
 * theirs. What it reads is kept by its bytes: a row read again as it was keeps
 * its decoded row, so a render never decodes it again, and the frame is handed
 * what it reads only when that moves. Once the week has landed, the weeks
 * either side are read ahead (`shared/schedule/read-ahead.ts`, #1398, CL7), in
 * a read of their own, so a step to one shows it at once and a page of theirs
 * landing runs the week's read no more; a step further drops their reads.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { BlobType, DateTimeType, DictType, SortedMap, equalFor } from "@elaraai/east";
import { RosterStatusType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { useReadAhead } from "../shared/schedule/use-read-ahead.js";
import { compareDate, compareString, rosterDomain, weekBefore, weekSpan, weekWindow, type RosterPayload, type Status, type StoredDuty, type StoredTarget } from "./model.js";

const sameBytes = equalFor(BlobType);
const samePicker = equalFor(DictType(DateTimeType, RosterStatusType));

/** What the Roster has read of its records for a week. */
export interface RosterData {
    /** The week it is of: its first day. */
    readonly start: Date;
    /** The week's stored duties, by key — what its window read, other weeks' among them. */
    readonly duties: ReadonlyMap<string, StoredDuty>;
    /** The week before's, read while the week holds none of its own: what Copy previous week copies; `undefined` otherwise, or while it is read. */
    readonly previous: ReadonlyMap<string, StoredDuty> | undefined;
    /** The week's own row's bytes, its period's; `undefined` for a week with no row, or a Roster with no periods. */
    readonly period: Uint8Array | undefined;
    /** The open picker's weeks' statuses, by their start: a week with no row is not among them. */
    readonly picker: SortedMap<Date, Status>;
    /** The week's targets, by key. */
    readonly targets: ReadonlyMap<string, StoredTarget>;
    /** Whether a read the week needs — its duties, its row or its targets — is in flight. */
    readonly loading: boolean;
    /** Whether a complete read of the week has landed. */
    readonly ready: boolean;
    /** Why the latest read failed. */
    readonly error: string | undefined;
}

const NO_DUTIES: ReadonlyMap<string, StoredDuty> = new Map();
const NO_TARGETS: ReadonlyMap<string, StoredTarget> = new Map();
const NO_STATUSES = new SortedMap<Date, Status>([], compareDate);

/**
 * The frame's data before its reader first reports: nothing held, a read in flight.
 *
 * @param start - The week the frame shows
 * @returns The state
 */
export function initialRosterData(start: Date): RosterData {
    return { start, duties: NO_DUTIES, previous: undefined, period: undefined, picker: NO_STATUSES, targets: NO_TARGETS, loading: true, ready: false, error: undefined };
}

/** Rows read again, each kept as it was where its bytes are: the same object, its row not decoded again. */
function keptDuties(read: ReadonlyMap<string, { roles: StoredDuty["roles"]; row: Uint8Array }>, held: ReadonlyMap<string, StoredDuty> | undefined,
    decode: (bytes: Uint8Array) => unknown): ReadonlyMap<string, StoredDuty> {
    const out = new SortedMap<string, StoredDuty>([], compareString);
    let same = held !== undefined && held.size === read.size;
    for (const [key, entry] of read) {
        const was = held?.get(key);
        if (was !== undefined && sameBytes(was.bytes, entry.row)) { out.set(key, was); continue; }
        same = false;
        out.set(key, { roles: entry.roles, bytes: entry.row, row: decode(entry.row) });
    }
    return same && held !== undefined ? held : out;
}
/** Targets read again, each kept as it was where its bytes are. */
function keptTargets(read: ReadonlyMap<string, { roles: StoredTarget["roles"]; row: Uint8Array }>, held: ReadonlyMap<string, StoredTarget> | undefined): ReadonlyMap<string, StoredTarget> {
    const out = new SortedMap<string, StoredTarget>([], compareString);
    let same = held !== undefined && held.size === read.size;
    for (const [key, entry] of read) {
        const was = held?.get(key);
        if (was !== undefined && sameBytes(was.bytes, entry.row)) { out.set(key, was); continue; }
        same = false;
        out.set(key, { roles: entry.roles, bytes: entry.row });
    }
    return same && held !== undefined ? held : out;
}

/**
 * Reads the week (see the module docs).
 *
 * @param value - The payload
 * @param start - The week's first day
 * @param pickerDates - The open picker's weeks' first days
 * @param holds - Whether the week's stored duties hold one of its own: the week before is read only while they do not
 * @returns What the Roster has read of the week
 */
export function useRosterData(value: RosterPayload, start: Date, pickerDates: readonly Date[], holds: (duties: ReadonlyMap<string, StoredDuty>) => boolean): RosterData {
    // What was read last, kept by its bytes across reads.
    const held = useRef<{ duties?: ReadonlyMap<string, StoredDuty>; previous?: ReadonlyMap<string, StoredDuty>; targets?: ReadonlyMap<string, StoredTarget>;
        picker?: SortedMap<Date, Status> }>({});
    const read = useCallback(() => {
        const domain = rosterDomain(value.duty.rowType);
        let loading = false;
        const window = weekWindow(start);
        const rows = value.duty.rows(window.from, window.to);
        let duties: ReadonlyMap<string, StoredDuty> | undefined;
        if (rows.type === "some") duties = keptDuties(rows.value, held.current.duties, domain.decodeRow);
        else loading = true;
        // The week before, which Copy previous week reads: only while the week holds none of its own.
        let previous: ReadonlyMap<string, StoredDuty> | undefined;
        if (duties !== undefined && !holds(duties)) {
            const before = weekWindow(weekBefore(start));
            const got = value.duty.rows(before.from, before.to);
            if (got.type === "some") previous = keptDuties(got.value, held.current.previous, domain.decodeRow);
        }
        const week = weekSpan(start);
        // The week's own row, by its start.
        let period: Uint8Array | undefined;
        let picker = NO_STATUSES;
        if (value.periods.type === "some") {
            const periods = value.periods.value;
            const got = periods.rows(week.from, week.to);
            if (got.type === "some") period = got.value.get(start);
            else loading = true;
            // The open picker's weeks: one span, from its first week to the end of its last.
            if (pickerDates.length > 0) {
                const first = pickerDates.reduce((a, b) => compareDate(a, b) <= 0 ? a : b);
                const last = pickerDates.reduce((a, b) => compareDate(a, b) >= 0 ? a : b);
                const span = periods.rows(first, weekSpan(last).to);
                if (span.type === "some") {
                    const statuses = new SortedMap([...span.value].map(([at, bytes]) => [at, periods.status(bytes)] as const), compareDate);
                    const was = held.current.picker;
                    picker = was !== undefined && samePicker(was, statuses) ? was : statuses;
                }
            }
        }
        // The week's targets, by their day.
        let targets = NO_TARGETS;
        if (value.targets.type === "some") {
            const got = value.targets.value.rows(week.from, week.to);
            if (got.type === "some") targets = keptTargets(got.value, held.current.targets);
            else loading = true;
        }
        return { duties, previous, period, picker, targets, loading };
    }, [value, start, pickerDates, holds]);
    const { result } = useTrackedEvaluation(read);
    // Once the week has landed, the weeks either side are read ahead (#1398, CL7) — in a read of their own, so a page of
    // theirs landing runs the week's read no more: a step to one shows it at once.
    const at = start.getTime();
    const neighbours = useMemo(() => [weekSpan(new Date(at)).to, weekBefore(new Date(at))], [at]);
    const readNext = useCallback((next: Date) => {
        const around = weekWindow(next);
        value.duty.rows(around.from, around.to);
        const span = weekSpan(next);
        if (value.periods.type === "some") value.periods.value.rows(span.from, span.to);
        if (value.targets.type === "some") value.targets.value.rows(span.from, span.to);
    }, [value]);
    useReadAhead(result.ok && !result.value.loading && result.value.duties !== undefined, neighbours, readNext);
    // The last complete read of a week: a newer one in flight keeps it, so a page landing redraws nothing until the read is whole.
    const complete = useRef<RosterData | undefined>(undefined);
    if (result.ok) {
        const got = result.value;
        held.current = { ...(got.duties === undefined ? {} : { duties: got.duties }), ...(got.previous === undefined ? {} : { previous: got.previous }),
            ...(Object.is(got.targets, NO_TARGETS) ? {} : { targets: got.targets }), ...(Object.is(got.picker, NO_STATUSES) ? {} : { picker: got.picker }) };
        const was = complete.current;
        if (!got.loading && got.duties !== undefined && (was === undefined || compareDate(was.start, start) !== 0 || !Object.is(was.duties, got.duties)
            || !Object.is(was.previous, got.previous) || !Object.is(was.targets, got.targets) || !Object.is(was.picker, got.picker)
            || (was.period === undefined ? got.period !== undefined : got.period === undefined || !sameBytes(was.period, got.period)))) {
            complete.current = { start, duties: got.duties, previous: got.previous, period: got.period, picker: got.picker, targets: got.targets,
                loading: false, ready: true, error: undefined };
        }
    }
    const last = complete.current;
    // A week moved to holds nothing of the week before it: its read is in flight until it lands.
    const current = last !== undefined && compareDate(last.start, start) === 0 ? last : undefined;
    const loading = result.ok ? result.value.loading || current === undefined : false;
    const error = result.ok ? undefined : result.error instanceof Error ? result.error.message : String(result.error);
    return useMemo(() => current === undefined ? { ...initialRosterData(start), loading, error }
        : current.loading === loading && current.error === error ? current : { ...current, loading, error }, [current, start, loading, error]);
}

/**
 * The week's reads, in a component of its own (#1343): each page and search
 * that lands re-runs it alone, and it hands the frame what it read only when
 * what the frame shows moves.
 *
 * @param props - The payload, the week, the open picker's weeks, which stored duties hold one of the week's, and where the data goes
 * @returns Nothing: it reads
 */
export function RosterDataReader({ value, start, pickerDates, holds, onData }: {
    value: RosterPayload; start: Date; pickerDates: readonly Date[]; holds: (duties: ReadonlyMap<string, StoredDuty>) => boolean; onData: (data: RosterData) => void;
}): null {
    const data = useRosterData(value, start, pickerDates, holds);
    const reported = useRef<RosterData | undefined>(undefined);
    useLayoutEffect(() => {
        if (Object.is(reported.current, data)) return;
        reported.current = data;
        onData(data);
    });
    return null;
}
