/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
import { usePersistedState } from "@elaraai/east-ui-components";
import { DAY, dayStart, type AllocationValue, type AllocationView } from "./model.js";

/** The board's view: its layout and its day, persisted under the board's key; the first view is the payload's, today by default. */
export interface AllocationWindow {
    view: AllocationView;
    setView: (next: AllocationView) => void;
    /** The plan day: the view's UTC midnight. */
    day: Date;
    /** Steps the day by whole days. */
    step: (days: number) => void;
}

export function useAllocationWindow(value: AllocationValue, key: string): AllocationWindow {
    const { state, setState } = usePersistedState<AllocationView>(`${key}.view`, {
        layout: value.settings.layout.type,
        date: dayStart(value.settings.date.type === "some" ? value.settings.date.value : new Date()).getTime(),
    });
    const day = useMemo(() => dayStart(state.date), [state.date]);
    return { view: state, setView: setState, day, step: days => setState({ ...state, date: day.getTime() + days * DAY }) };
}
