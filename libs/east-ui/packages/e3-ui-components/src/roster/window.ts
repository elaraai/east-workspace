/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
import { RosterLayoutType, RosterPeriodType } from "@elaraai/e3-ui/internal";
import { usePageView } from "../shared/schedule/page-view.js";
import { DAY, dayStart, weekStart, type RosterValue, type RosterView } from "./model.js";

export interface RosterWindow { view: RosterView; setView: (next: RosterView) => void; start: Date; day: number }

/**
 * The view storage keeps, read defensively — storage outlives versions, and anything may write it: an object whose
 * layout and period are cases of the Roster's own, and whose date is a finite epoch.
 *
 * @param stored - What storage keeps under the view's key
 * @returns The view; `undefined` for anything else
 */
function rosterViewOf(stored: unknown): RosterView | undefined {
    if (typeof stored !== "object" || stored === null) return undefined;
    const { layout, period, date } = stored as Partial<Record<keyof RosterView, unknown>>;
    if (typeof layout !== "string" || !Object.hasOwn(RosterLayoutType.cases, layout)) return undefined;
    if (typeof period !== "string" || !Object.hasOwn(RosterPeriodType.cases, period)) return undefined;
    if (typeof date !== "number" || !Number.isFinite(date)) return undefined;
    return { layout: layout as RosterView["layout"], period: period as RosterView["period"], date };
}

/**
 * The week is the Roster's own: its navigation and its picker choose it, kept per viewer (#1342: no Slice picks it).
 * Its view is the page's own (#1398, `shared/schedule/page-view.ts`), as the window it writes into its source is:
 * another page keeping a view moves neither, and a reload opens on the view kept last.
 *
 * @param value - The payload: the author's view, and the week's start
 * @param key - The Roster's storage key
 * @returns The view, what moves it, the week's first day and the view's day in it
 */
export function useRosterWindow(value: RosterValue, key: string): RosterWindow {
    const { view, setView } = usePageView<RosterView>(`${key}.view`, {
        layout: value.settings.layout.type, period: value.settings.period.type,
        date: dayStart(value.settings.date.type === "some" ? value.settings.date.value : new Date()).getTime(),
    }, rosterViewOf);
    const sunday = value.settings.weekStart.type === "sunday";
    const start = useMemo(() => weekStart(new Date(view.date), sunday), [view.date, sunday]);
    const day = Math.floor((dayStart(view.date).getTime() - start.getTime()) / DAY);
    // People always renders a week; the Shifts period preference is kept.
    return { view, setView, start, day };
}
