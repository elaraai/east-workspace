/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
import { usePersistedState } from "@elaraai/east-ui-components";
import { DAY, dayStart, weekStart, type RosterValue, type RosterView } from "./model.js";

export interface RosterWindow { view: RosterView; setView: (next: RosterView) => void; start: Date; day: number }
/** The week is the Roster's own: its navigation and its picker choose it, kept per viewer (#1342: no Slice picks it). */
export function useRosterWindow(value: RosterValue, key: string): RosterWindow {
    const { state: view, setState: setView } = usePersistedState<RosterView>(`${key}.view`, {
        layout: value.settings.layout.type, period: value.settings.period.type,
        date: dayStart(value.settings.date.type === "some" ? value.settings.date.value : new Date()).getTime(),
    });
    const sunday = value.settings.weekStart.type === "sunday";
    const start = useMemo(() => weekStart(new Date(view.date), sunday), [view.date, sunday]);
    const day = Math.floor((dayStart(view.date).getTime() - start.getTime()) / DAY);
    // People always renders a week; the Shifts period preference is kept.
    return { view, setView, start, day };
}
