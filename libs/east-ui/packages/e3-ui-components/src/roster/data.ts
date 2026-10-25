/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's reads of the app's records (#1369, `Builder Interfaces Spec.md`
 * §7.5, §9), in a component of its own, as the Calendar's window is (#1343):
 * the span's duties through the duty kind's `rows` — over the span's weeks and
 * the twelve hours either side a duty's start may stand from its shift's
 * (`spanWindow`), and the week before's while a week in view holds none, which
 * Copy previous week reads — each week's own row through the periods' `rows`,
 * the open picker's weeks' through the same, and the span's targets through
 * theirs. A span is one week, or a month's four to six (#1406, P26), its reads
 * swapped at once. What it reads is kept by its bytes: a row read again as it
 * was keeps its decoded row, so a render never decodes it again, and the frame
 * is handed what it reads only when that moves. Once the span has landed, the
 * spans either side — the weeks, or the months — are read ahead
 * (`shared/schedule/read-ahead.ts`, #1398, CL7), in a read of their own, so a
 * step to one shows it at once and a page of theirs landing runs the span's
 * read no more; a step further drops their reads.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { BlobType, DateTimeType, DictType, SortedMap, equalFor } from "@elaraai/east";
import { RosterStatusType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { useReadAhead } from "../shared/schedule/use-read-ahead.js";
import { shiftCalendar } from "../shared/time/scale.js";
import {
    DAY, compareDate, compareString, rosterDomain, rosterSpan, spanWindow, weekBefore, weekSpan, weekWindow,
    type RosterPayload, type RosterSpan, type Status, type StoredDuty, type StoredTarget,
} from "./model.js";

const sameBytes = equalFor(BlobType);
const samePicker = equalFor(DictType(DateTimeType, RosterStatusType));

/** What the Roster has read of its records for a span. */
export interface RosterData {
    /** The span it is of: its first week's first day. */
    readonly start: Date;
    /** Its weeks' first days. */
    readonly weeks: readonly Date[];
    /** The span's stored duties, by key — what its window read, other weeks' among them. */
    readonly duties: ReadonlyMap<string, StoredDuty>;
    /** The week before's, read while a week in view holds none of its own: what Copy previous week copies; `undefined` otherwise, or while it is read. */
    readonly previous: ReadonlyMap<string, StoredDuty> | undefined;
    /** Each week's own row's bytes, its period's, by the week's first day: a week with no row is not among them, nor any week of a Roster with no periods. */
    readonly periods: SortedMap<Date, Uint8Array>;
    /** The open picker's weeks' statuses, by their start: a week with no row is not among them. */
    readonly picker: SortedMap<Date, Status>;
    /** The span's targets, by key. */
    readonly targets: ReadonlyMap<string, StoredTarget>;
    /** Whether a read the span needs — its duties, its weeks' rows or its targets — is in flight. */
    readonly loading: boolean;
    /** Whether a complete read of the span has landed. */
    readonly ready: boolean;
    /**
     * Whether a complete read of any span has landed: the frame's cold load is
     * over (#1398, CL5), and a span not read yet is read with the frame live,
     * its geometry drawn and its placeholders where its content goes.
     */
    readonly landed: boolean;
    /** Why the latest read failed. */
    readonly error: string | undefined;
}

const NO_DUTIES: ReadonlyMap<string, StoredDuty> = new Map();
const NO_TARGETS: ReadonlyMap<string, StoredTarget> = new Map();
const NO_STATUSES = new SortedMap<Date, Status>([], compareDate);
const NO_PERIODS = new SortedMap<Date, Uint8Array>([], compareDate);

/**
 * The frame's data before its reader first reports: nothing held, a read in flight.
 *
 * @param span - The span the frame shows
 * @returns The state
 */
export function initialRosterData(span: Pick<RosterSpan, "start" | "weeks">): RosterData {
    return { start: span.start, weeks: span.weeks, duties: NO_DUTIES, previous: undefined, periods: NO_PERIODS, picker: NO_STATUSES, targets: NO_TARGETS,
        loading: true, ready: false, landed: false, error: undefined };
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
/** The weeks' own rows read again, kept as they were where their bytes are. */
function keptPeriods(read: ReadonlyMap<Date, Uint8Array>, weeks: readonly Date[], held: SortedMap<Date, Uint8Array> | undefined): SortedMap<Date, Uint8Array> {
    const out = new SortedMap<Date, Uint8Array>([], compareDate);
    for (const week of weeks) {
        const row = read.get(week);
        if (row !== undefined) out.set(week, row);
    }
    if (held !== undefined && held.size === out.size && [...out].every(([week, row]) => { const was = held.get(week); return was !== undefined && sameBytes(was, row); })) return held;
    return out;
}

/**
 * Reads the span (see the module docs).
 *
 * @param value - The payload
 * @param span - The span in view
 * @param pickerDates - The open picker's weeks' first days
 * @param holds - Whether the span's stored duties hold one of its first week's: the week before is read only while a one-week span does not
 * @returns What the Roster has read of the span
 */
export function useRosterData(value: RosterPayload, span: RosterSpan, pickerDates: readonly Date[], holds: (duties: ReadonlyMap<string, StoredDuty>) => boolean): RosterData {
    // What was read last, kept by its bytes across reads.
    const held = useRef<{ duties?: ReadonlyMap<string, StoredDuty>; previous?: ReadonlyMap<string, StoredDuty>; targets?: ReadonlyMap<string, StoredTarget>;
        periods?: SortedMap<Date, Uint8Array>; picker?: SortedMap<Date, Status> }>({});
    const { start, weeks } = span;
    const read = useCallback(() => {
        const domain = rosterDomain(value.duty.rowType);
        let loading = false;
        const window = spanWindow(span);
        const rows = value.duty.rows(window.from, window.to);
        let duties: ReadonlyMap<string, StoredDuty> | undefined;
        if (rows.type === "some") duties = keptDuties(rows.value, held.current.duties, domain.decodeRow);
        else loading = true;
        // The week before, which Copy previous week reads: only while a one-week span holds none of its own.
        let previous: ReadonlyMap<string, StoredDuty> | undefined;
        if (duties !== undefined && weeks.length === 1 && !holds(duties)) {
            const before = weekWindow(weekBefore(start));
            const got = value.duty.rows(before.from, before.to);
            if (got.type === "some") previous = keptDuties(got.value, held.current.previous, domain.decodeRow);
        }
        // Each week's own row, by its start.
        let periods = NO_PERIODS;
        let picker = NO_STATUSES;
        if (value.periods.type === "some") {
            const kind = value.periods.value;
            const got = kind.rows(span.from, span.to);
            if (got.type === "some") periods = keptPeriods(got.value, weeks, held.current.periods);
            else loading = true;
            // The open picker's weeks: one span, from its first week to the end of its last.
            if (pickerDates.length > 0) {
                const first = pickerDates.reduce((a, b) => compareDate(a, b) <= 0 ? a : b);
                const last = pickerDates.reduce((a, b) => compareDate(a, b) >= 0 ? a : b);
                const statuses = kind.rows(first, weekSpan(last).to);
                if (statuses.type === "some") {
                    const next = new SortedMap([...statuses.value].map(([at, bytes]) => [at, kind.status(bytes)] as const), compareDate);
                    const was = held.current.picker;
                    picker = was !== undefined && samePicker(was, next) ? was : next;
                }
            }
        }
        // The span's targets, by their day.
        let targets = NO_TARGETS;
        if (value.targets.type === "some") {
            const got = value.targets.value.rows(span.from, span.to);
            if (got.type === "some") targets = keptTargets(got.value, held.current.targets);
            else loading = true;
        }
        return { duties, previous, periods, picker, targets, loading };
    }, [value, span, start, weeks, pickerDates, holds]);
    const { result } = useTrackedEvaluation(read);
    // Once the span has landed, the spans either side are read ahead (#1398, CL7) — in a read of their own, so a page of
    // theirs landing runs the span's read no more: a step to one shows it at once.
    const at = start.getTime(), period = span.period, sunday = (weeks[0]?.getUTCDay() ?? 1) === 0;
    const neighbours = useMemo(() => period === "month"
        ? [rosterSpan(shiftCalendar(span.month ?? new Date(at), "month", 1).getTime(), "month", sunday), rosterSpan(shiftCalendar(span.month ?? new Date(at), "month", -1).getTime(), "month", sunday)]
        : [rosterSpan(at + 7 * DAY, period, sunday), rosterSpan(at - 7 * DAY, period, sunday)],
        // The span's month is a function of its start and period: the three say when it moves.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [at, period, sunday]);
    const readNext = useCallback((next: RosterSpan) => {
        const around = spanWindow(next);
        value.duty.rows(around.from, around.to);
        if (value.periods.type === "some") value.periods.value.rows(next.from, next.to);
        if (value.targets.type === "some") value.targets.value.rows(next.from, next.to);
    }, [value]);
    useReadAhead(result.ok && !result.value.loading && result.value.duties !== undefined, neighbours, readNext);
    // The last complete read of a span: a newer one in flight keeps it, so a page landing redraws nothing until the read is whole.
    const complete = useRef<RosterData | undefined>(undefined);
    if (result.ok) {
        const got = result.value;
        held.current = { ...(got.duties === undefined ? {} : { duties: got.duties }), ...(got.previous === undefined ? {} : { previous: got.previous }),
            ...(Object.is(got.targets, NO_TARGETS) ? {} : { targets: got.targets }), ...(Object.is(got.periods, NO_PERIODS) ? {} : { periods: got.periods }),
            ...(Object.is(got.picker, NO_STATUSES) ? {} : { picker: got.picker }) };
        const was = complete.current;
        if (!got.loading && got.duties !== undefined && (was === undefined || compareDate(was.start, start) !== 0 || was.weeks.length !== weeks.length
            || !Object.is(was.duties, got.duties) || !Object.is(was.previous, got.previous) || !Object.is(was.targets, got.targets)
            || !Object.is(was.picker, got.picker) || !Object.is(was.periods, got.periods))) {
            complete.current = { start, weeks, duties: got.duties, previous: got.previous, periods: got.periods, picker: got.picker, targets: got.targets,
                loading: false, ready: true, landed: true, error: undefined };
        }
    }
    const last = complete.current;
    // A span moved to holds nothing of the span before it: its read is in flight until it lands.
    const current = last !== undefined && compareDate(last.start, start) === 0 && last.weeks.length === weeks.length ? last : undefined;
    const landed = last !== undefined;
    const loading = result.ok ? result.value.loading || current === undefined : false;
    const error = result.ok ? undefined : result.error instanceof Error ? result.error.message : String(result.error);
    return useMemo(() => current === undefined ? { ...initialRosterData(span), loading, landed, error }
        : current.loading === loading && current.error === error ? current : { ...current, loading, error }, [current, span, loading, landed, error]);
}

/**
 * The span's reads, in a component of its own (#1343): each page and search
 * that lands re-runs it alone, and it hands the frame what it read only when
 * what the frame shows moves.
 *
 * @param props - The payload, the span, the open picker's weeks, which stored duties hold one of the first week's, and where the data goes
 * @returns Nothing: it reads
 */
export function RosterDataReader({ value, span, pickerDates, holds, onData }: {
    value: RosterPayload; span: RosterSpan; pickerDates: readonly Date[]; holds: (duties: ReadonlyMap<string, StoredDuty>) => boolean; onData: (data: RosterData) => void;
}): null {
    const data = useRosterData(value, span, pickerDates, holds);
    const reported = useRef<RosterData | undefined>(undefined);
    useLayoutEffect(() => {
        if (Object.is(reported.current, data)) return;
        reported.current = data;
        onData(data);
    });
    return null;
}
