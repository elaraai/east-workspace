/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Author-bound Slice chrome and the time window used by Schedule's index reader. */
import { useMemo } from "react";
import { some, variant, type ValueTypeOf } from "@elaraai/east";
import type { SliceBindType } from "@elaraai/east-ui/internal";
import { usePersistedState, useSliceReactivity } from "@elaraai/east-ui-components";
import { calendarRange, DAY, dayStart, type CalendarRange, type CalendarValue, type CalendarView } from "./model.js";
import { timelineRange } from "./timeline.js";

/** The window and shared controls that every Calendar layout consumes. */
export interface CalendarWindow {
    view: CalendarView; setView: (next: CalendarView) => void; range: CalendarRange;
    slice: ValueTypeOf<typeof SliceBindType> | undefined; affordances: readonly string[];
}

/** The author's Slice is the range owner; layout and period remain viewer preferences. */
export function useCalendarWindow(value: CalendarValue, key: string, now: Date): CalendarWindow {
    const slice = value.slice.type === "some" ? value.slice.value.slice : undefined;
    useSliceReactivity(slice?.key);
    const affordances = useMemo(() => value.slice.type === "some" ? value.slice.value.affordances.map(a => a.type) : [], [value.slice]);
    const { state, setState } = usePersistedState<CalendarView>(`${key}.view`, {
        layout: value.settings.layout.type, period: value.settings.period.type,
        date: dayStart(value.settings.date.type === "some" ? value.settings.date.value : now).getTime(),
    });
    const bound = slice?.read().range;
    const datetime = bound?.type === "some" && bound.value.type === "datetime" ? bound.value.value : undefined;
    const from = datetime === undefined ? undefined : dayStart(datetime.from).getTime();
    // Slice endpoints are inclusive; the schedule reader uses half-open days.
    const to = datetime === undefined ? undefined : dayStart(datetime.to).getTime() + DAY;
    const view = useMemo(() => from === undefined || (state.date >= from && state.date < (to ?? from)) ? state : { ...state, date: from }, [state, from, to]);
    const range = useMemo((): CalendarRange => {
        if (from === undefined || to === undefined || to <= from) return view.layout === "timeline" ? timelineRange(view) : calendarRange(view, value.settings);
        const days: Date[] = [];
        for (let at = from; at < to; at += DAY) {
            const day = new Date(at);
            if (value.settings.weekends || (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)) days.push(day);
        }
        return { from: new Date(from), to: new Date(to), days };
    }, [from, to, view, value.settings]);
    const setView = (next: CalendarView) => {
        setState(next);
        if (slice !== undefined && slice.rangeFieldId().type === "some") {
            const window = next.layout === "timeline" ? timelineRange(next) : calendarRange(next, value.settings);
            slice.setRange(some(variant("datetime", { from: window.from, to: new Date(window.to.getTime() - 1) })));
        }
    };
    return { view, setView, range, slice, affordances };
}
