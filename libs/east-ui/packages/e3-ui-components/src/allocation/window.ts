/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
import { AllocationLayoutType } from "@elaraai/e3-ui/internal";
import { usePageView } from "../shared/schedule/page-view.js";
import { DAY, dayStart, type AllocationValue, type AllocationView } from "./model.js";

/**
 * The board's view: its layout and its day, the first the payload's, today by default — the page's own (#1398,
 * `shared/schedule/page-view.ts`), as the window it writes into its source is: another page keeping a view moves
 * neither, and a reload opens on the view kept last under the board's key.
 */
export interface AllocationWindow {
    view: AllocationView;
    setView: (next: AllocationView) => void;
    /** The plan day: the view's UTC midnight. */
    day: Date;
    /** Steps the day by whole days. */
    step: (days: number) => void;
}

/**
 * The view storage keeps, read defensively — storage outlives versions, and anything may write it: an object whose
 * layout is a case of the board's own, and whose date is a finite epoch.
 *
 * @param stored - What storage keeps under the view's key
 * @returns The view; `undefined` for anything else
 */
function allocationViewOf(stored: unknown): AllocationView | undefined {
    if (typeof stored !== "object" || stored === null) return undefined;
    const { layout, date } = stored as Partial<Record<keyof AllocationView, unknown>>;
    if (typeof layout !== "string" || !Object.hasOwn(AllocationLayoutType.cases, layout)) return undefined;
    if (typeof date !== "number" || !Number.isFinite(date)) return undefined;
    return { layout: layout as AllocationView["layout"], date };
}

/**
 * The board's view and its day (see {@link AllocationWindow}).
 *
 * @param value - The payload: the author's view
 * @param key - The board's storage key
 * @returns The view, what moves it, its day and what steps it
 */
export function useAllocationWindow(value: AllocationValue, key: string): AllocationWindow {
    const { view: state, setView: setState } = usePageView<AllocationView>(`${key}.view`, {
        layout: value.settings.layout.type,
        date: dayStart(value.settings.date.type === "some" ? value.settings.date.value : new Date()).getTime(),
    }, allocationViewOf);
    const day = useMemo(() => dayStart(state.date), [state.date]);
    return { view: state, setView: setState, day, step: days => setState({ ...state, date: day.getTime() + days * DAY }) };
}
