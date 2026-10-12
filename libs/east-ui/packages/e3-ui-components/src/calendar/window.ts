/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Author-bound Slice chrome and the time window used by Schedule's index reader. */
import { useLayoutEffect, useMemo } from "react";
import { some, variant, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceChromeType, SliceBindType } from "@elaraai/east-ui/internal";
import { usePersistedState, useSliceReactivity } from "@elaraai/east-ui-components";
import { calendarRange, DAY, dayStart, type CalendarRange, type CalendarValue, type CalendarView } from "./model.js";
import { recordSliceWindow, setRecordSliceWindow } from "@elaraai/east-ui-components/internal";
import { timelineRange } from "./timeline.js";

/** The window and shared controls that every Calendar layout consumes. */
export interface CalendarWindow {
    view: CalendarView; setView: (next: CalendarView) => void; range: CalendarRange;
    slice: ValueTypeOf<typeof SliceBindType> | undefined; affordances: readonly string[];
    recordChrome: ValueTypeOf<RecordSliceChromeType> | undefined;
}

/** The author's Slice is the range owner; layout and period remain viewer preferences. */
export function useCalendarWindow(value: CalendarValue, key: string, now: Date): CalendarWindow {
    const slice = value.slice.type === "some" ? value.slice.value.slice : undefined;
    const recordChrome = value.recordSlice?.type === "some" ? value.recordSlice.value : undefined;
    const record = recordChrome?.slice;
    useSliceReactivity(record?.key ?? slice?.key);
    const affordances = useMemo(() => (recordChrome ?? (value.slice.type === "some" ? value.slice.value : undefined))?.affordances.map(a => a.type) ?? [], [value.slice, recordChrome]);
    const { state, setState } = usePersistedState<CalendarView>(`${key}.view`, {
        layout: value.settings.layout.type, period: value.settings.period.type,
        date: dayStart(value.settings.date.type === "some" ? value.settings.date.value : now).getTime(),
    });
    const bound = slice?.read().range;
    const datetime = bound?.type === "some" && bound.value.type === "datetime" ? bound.value.value : undefined;
    const indexed = record === undefined ? undefined : recordSliceWindow(record);
    const from = indexed?.kind === "datetime" ? indexed.min : datetime === undefined ? undefined : dayStart(datetime.from).getTime();
    // Local Slice is inclusive; record Slice and schedule windows are half-open.
    const to = indexed?.kind === "datetime" ? indexed.max : datetime === undefined ? undefined : dayStart(datetime.to).getTime() + DAY;
    const view = useMemo(() => from === undefined || (state.date >= from && state.date < (to ?? from)) ? state : { ...state, date: from }, [state, from, to]);
    const range = useMemo((): CalendarRange => {
        if (from === undefined || to === undefined || to <= from) return view.layout === "timeline" ? timelineRange(view) : calendarRange(view, value.settings);
        const days: Date[] = [];
        for (let at = dayStart(from).getTime(); at < to; at += DAY) {
            const day = new Date(at);
            if (value.settings.weekends || (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)) days.push(day);
        }
        return { from: new Date(from), to: new Date(to), days };
    }, [from, to, view, value.settings]);
    const rangeField = record?.config.range;
    const needsWindow = rangeField?.type === "some" && !record?.read().where.has(rangeField.value);
    useLayoutEffect(() => {
        if (record !== undefined && needsWindow) setRecordSliceWindow(record, range.from.getTime(), range.to.getTime());
    }, [record, needsWindow, range.from, range.to]);
    const setView = (next: CalendarView) => {
        setState(next);
        if (record !== undefined) {
            const window = next.layout === "timeline" ? timelineRange(next) : calendarRange(next, value.settings);
            setRecordSliceWindow(record, window.from.getTime(), window.to.getTime());
        } else if (slice !== undefined && slice.rangeFieldId().type === "some") {
            const window = next.layout === "timeline" ? timelineRange(next) : calendarRange(next, value.settings);
            slice.setRange(some(variant("datetime", { from: window.from, to: new Date(window.to.getTime() - 1) })));
        }
    };
    return { view, setView, range, slice, recordChrome, affordances };
}
