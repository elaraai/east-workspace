/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Tracked Schedule reads and the shared Slice over the loaded window. */
import { useCallback, useMemo, useRef } from "react";
import { DateTimeType, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { SliceBindType, sliceMatches } from "@elaraai/east-ui/internal";
import { buildSliceHandle, DEFAULT_SLICE_STATE, useSliceReactivity, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { EMPTY_SCHEDULE_DRAFTS, type ScheduleEditing } from "../shared/schedule/editing.js";
import { chronological, eventKey, resourceKey, type CalendarItem, type CalendarRange, type CalendarRow, type CalendarValue } from "./model.js";

type SliceConfig = Parameters<typeof sliceMatches>[1];
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
export function resourceRows(value: CalendarValue): CalendarRow[] {
    return value.resources.flatMap(kind => kind.rows.map(row => ({ key: resourceKey({ kind: kind.key, key: row.key }),
        label: row.label, meta: row.meta.type === "some" ? row.meta.value : "", group: kind.name, icon: kind.icon,
        resource: some({ kind: kind.key, key: row.key }),
    })));
}

/** Internal Slice, using exactly the shared handle, predicate engine and toolbar. */
export function useCalendarSlice(value: CalendarValue, items: readonly CalendarItem[], key: string, now: Date): { slice: ValueTypeOf<typeof SliceBindType>; selected: ReadonlySet<string>; items: readonly CalendarItem[]; resources: readonly CalendarRow[] } {
    const rows = useMemo(() => items.map(item => {
        const resource = item.resource.type === "some" ? item.resource.value : undefined;
        const resourceKind = value.resources.find(kind => kind.key === resource?.kind);
        return { id: eventKey({ kind: item.kind, key: item.key }), title: item.title,
            kind: value.events.find(kind => kind.key === item.kind)?.name ?? item.kind,
            resourceKind: resourceKind?.name ?? "Unassigned",
            resource: resourceKind?.rows.find(row => row.key === resource?.key)?.label ?? resource?.key ?? "Unassigned",
            status: item.status.type === "some" ? item.status.value.label : "" };
    }), [value.resources, value.events, items]);
    const config = useMemo((): SliceConfig => ({
        fields: new Map(["title", "kind", "resourceKind", "resource", "status"].map(field => [field,
            variant("string", { label: field === "resourceKind" ? "Resource kind" : field[0]!.toUpperCase() + field.slice(1),
                accessor: (row: Record<string, unknown>) => row[field] as string, format: none })])),
        rangeFieldId: none, searchFieldIds: ["title", "resource", "kind"], breakdownFieldIds: [], fieldHints: new Map(),
    }), []);
    const slice = useMemo(() => buildSliceHandle(key, config, DEFAULT_SLICE_STATE, rows, none) as unknown as ValueTypeOf<typeof SliceBindType>, [key, config, rows]);
    const version = useSliceReactivity(key);
    const selected = useMemo(() => {
        const state = slice.read();
        return new Set(rows.filter(row => sliceMatches(state, config, row, now)).map(row => row.id));
        // The shared store version changes without changing the handle identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slice, config, rows, now, version]);
    const resources = useMemo(() => {
        const state = slice.read();
        const resourceState = { ...state, search: none, filters: state.filters.filter(p => p.value.fieldId === "resourceKind" || p.value.fieldId === "resource"),
            cohorts: state.cohorts.map(c => ({ ...c, filters: c.filters.filter(p => p.value.fieldId === "resourceKind" || p.value.fieldId === "resource") })) };
        return [...resourceRows(value), { key: "", label: "Unassigned", meta: "", group: "", resource: none }].filter(row =>
            sliceMatches(resourceState, config, { resourceKind: row.group || "Unassigned", resource: row.label }, now));
        // The shared store version changes without changing the handle identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slice, config, value.resources, now, version]);
    return { slice, selected, resources, items: items.filter(item => selected.has(eventKey({ kind: item.kind, key: item.key }))) };
}
