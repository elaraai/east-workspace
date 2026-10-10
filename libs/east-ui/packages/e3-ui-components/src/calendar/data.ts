/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Tracked Schedule reads over the author-selected window. */
import { useCallback, useRef } from "react";
import { DateTimeType, compareFor, some } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { EMPTY_SCHEDULE_DRAFTS, type ScheduleEditing } from "../shared/schedule/editing.js";
import { chronological, resourceKey, type CalendarItem, type CalendarRange, type CalendarRow, type CalendarValue } from "./model.js";

/** A window read, including its unscheduled source. */
export interface CalendarData { items: CalendarItem[]; backlog: CalendarItem[]; loading: boolean; saved: Date | undefined }
const EMPTY: CalendarData = { items: [], backlog: [], loading: true, saved: undefined };
const compareDate = compareFor(DateTimeType);

/** Read only the requested window and, when listed, its unscheduled source. */
export function useCalendarData(value: CalendarValue, range: CalendarRange, editing?: ScheduleEditing) {
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
                const unscheduled = kind.unscheduled(changes);
                if (unscheduled.type === "some") { for (const item of unscheduled.value) backlog.push(item); } else loading = true;
            }
        }
        return { items: chronological(items), backlog, loading, saved };
    }, [value.events, range.from, range.to, drafts]);
    const { result } = useTrackedEvaluation(read);
    const held = useRef(EMPTY);
    if (result.ok) held.current = result.value;
    return { ...held.current, error: result.ok ? undefined : String(result.error) };
}

/** Named resource rows, preserving the author's declaration order. */
export function resourceRows(resources: CalendarValue["resources"]): CalendarRow[] {
    return resources.flatMap(kind => kind.rows.map(row => ({ key: resourceKey({ kind: kind.key, key: row.key }),
        label: row.label, meta: row.meta.type === "some" ? row.meta.value : "", group: kind.name, icon: kind.icon,
        resource: some({ kind: kind.key, key: row.key }),
    })));
}
