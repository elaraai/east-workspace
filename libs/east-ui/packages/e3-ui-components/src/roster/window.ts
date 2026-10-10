/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
import { some, variant } from "@elaraai/east";
import { usePersistedState, useSliceReactivity } from "@elaraai/east-ui-components";
import { DAY, dayStart, weekStart, type RosterValue, type RosterView } from "./model.js";

export interface RosterWindow {
    view: RosterView; setView: (next: RosterView) => void; start: Date; day: number;
    slice: Extract<RosterValue["slice"], { type: "some" }>["value"]["slice"] | undefined; affordances: string[];
}
/** Slice's first date selects one week; navigation writes that whole week back. */
export function useRosterWindow(value: RosterValue, key: string): RosterWindow {
    const slice = value.slice.type === "some" ? value.slice.value.slice : undefined;
    useSliceReactivity(slice?.key);
    const { state, setState } = usePersistedState<RosterView>(`${key}.view`, {
        layout: value.settings.layout.type, period: value.settings.period.type,
        date: dayStart(value.settings.date.type === "some" ? value.settings.date.value : new Date()).getTime(),
    });
    const sunday = value.settings.weekStart.type === "sunday";
    const bound = slice?.read().range;
    const first = bound?.type === "some" && bound.value.type === "datetime" ? weekStart(bound.value.value.from, sunday).getTime() : undefined;
    const local = weekStart(new Date(state.date), sunday).getTime();
    const view = useMemo(() => first === undefined || first === local ? state : { ...state, date: first }, [first, local, state]);
    const start = useMemo(() => weekStart(new Date(view.date), sunday), [view.date, sunday]);
    const day = Math.floor((dayStart(view.date).getTime() - start.getTime()) / DAY);
    const setView = (next: RosterView) => {
        const normalized = { ...next, period: next.layout === "people" ? "week" as const : next.period };
        setState(normalized);
        const from = weekStart(new Date(next.date), sunday);
        if (slice !== undefined && slice.rangeFieldId().type === "some" && (from.getTime() !== start.getTime() || first === undefined)) {
            slice.setRange(some(variant("datetime", { from, to: new Date(from.getTime() + 7 * DAY - 1) })));
        }
    };
    const affordances = useMemo(() => value.slice.type === "some" ? value.slice.value.affordances.map(a => a.type) : [], [value.slice]);
    return { view, setView, start, day, slice, affordances };
}
