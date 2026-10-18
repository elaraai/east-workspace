/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Tracked Schedule reads over the author-selected window. */
import { useCallback, useLayoutEffect, useRef } from "react";
import { DateTimeType, compareFor, some } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { EMPTY_SCHEDULE_DRAFTS, type ScheduleEditing } from "../shared/schedule/editing.js";
import { chronological, resourceKey, type CalendarItem, type CalendarRange, type CalendarRow, type CalendarValue } from "./model.js";

/** A window read, including its unscheduled source. */
export interface CalendarData { items: CalendarItem[]; backlog: CalendarItem[]; loading: boolean; saved: Date | undefined }
const EMPTY: CalendarData = { items: [], backlog: [], loading: true, saved: undefined };
const compareDate = compareFor(DateTimeType);

/** What the frame shows of the window read: the last complete read, its range, and whether a newer one is in flight or failed. */
export interface CalendarDataState extends CalendarData {
    /** The range the held read covers. */
    range: CalendarRange;
    /** Whether any read has completed. */
    ready: boolean;
    /** Why the latest read failed. */
    error: string | undefined;
}

/**
 * The frame's data before its reader first reports: nothing held, a read in flight.
 *
 * @param range - The range the frame reads
 * @returns The state
 */
export function initialCalendarData(range: CalendarRange): CalendarDataState {
    return { ...EMPTY, range, ready: false, error: undefined };
}

/** Read only the requested window and, when listed, its unscheduled source. */
export function useCalendarData(value: CalendarValue, range: CalendarRange, editing?: ScheduleEditing): CalendarDataState {
    const drafts = editing?.drafts;
    const read = useCallback((): CalendarData => {
        const items: CalendarItem[] = []; const backlog: CalendarItem[] = [];
        let loading = false;
        let saved: Date | undefined;
        for (const kind of value.events) {
            const changes = drafts?.get(kind.key) ?? EMPTY_SCHEDULE_DRAFTS;
            const scheduled = kind.items(range.from, range.to, changes);
            if (scheduled.type === "some") { for (const item of scheduled.value) items.push(item); } else loading = true;
            const history = kind.history();
            const latest = history.type === "some" ? history.value[0]?.at : undefined;
            if (latest !== undefined && (saved === undefined || compareDate(latest, saved) > 0)) saved = latest;
            if (kind.backlog) {
                const unscheduled = kind.unscheduled(range.from, range.to, changes);
                if (unscheduled.type === "some") { for (const item of unscheduled.value) backlog.push(item); } else loading = true;
            }
        }
        return { items: chronological(items), backlog, loading, saved };
    }, [value.events, range.from, range.to, drafts]);
    const { result } = useTrackedEvaluation(read);
    const held = useRef(EMPTY);
    const heldRange = useRef(range);
    // A pending or failed replacement is not a partial/empty result. Publish
    // scheduled rows, backlog and their time geometry together when ready.
    if (result.ok && !result.value.loading) { held.current = result.value; heldRange.current = range; }
    return { ...held.current, range: heldRange.current, ready: held.current !== EMPTY,
        loading: result.ok && result.value.loading, error: result.ok ? undefined : String(result.error) };
}

/**
 * The window read, in a component of its own (#1343): each search that lands re-runs it alone, and it hands the frame
 * its data only when what the frame shows moves. A kind narrowed through an interval index lands some fifty-five
 * searches before its count is known, and each would otherwise re-render the whole frame.
 *
 * @param props - The payload, the range read, the editing whose drafts the read holds, and where the data goes
 * @returns Nothing: it reads
 */
export function CalendarDataReader({ value, range, editing, onData }: {
    value: CalendarValue; range: CalendarRange; editing: ScheduleEditing | undefined; onData: (data: CalendarDataState) => void;
}): null {
    const data = useCalendarData(value, range, editing);
    const reported = useRef<CalendarDataState | undefined>(undefined);
    useLayoutEffect(() => {
        const was = reported.current;
        // The same held read over the same range, in the same state: nothing the frame shows has moved.
        if (was !== undefined && Object.is(was.items, data.items) && Object.is(was.backlog, data.backlog) && Object.is(was.range, data.range)
            && was.ready === data.ready && was.loading === data.loading && was.error === data.error) return;
        reported.current = data;
        onData(data);
    });
    return null;
}

/** Named resource rows, preserving the author's declaration order. */
export function resourceRows(resources: CalendarValue["resources"]): CalendarRow[] {
    return resources.flatMap(kind => kind.rows.map(row => ({ key: resourceKey({ kind: kind.key, key: row.key }),
        label: row.label, meta: row.meta.type === "some" ? row.meta.value : "", group: kind.name, icon: kind.icon,
        resource: some({ kind: kind.key, key: row.key }),
    })));
}
