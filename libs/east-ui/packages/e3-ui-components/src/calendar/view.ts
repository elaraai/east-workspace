/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Calendar's view — its layout, its period and its date — the page's own
 * (#1398, `shared/schedule/page-view.ts`): held beside the date window its
 * event sources hold, for as long as the page's UI store holds that window, so
 * a step writes the two together and every render reads them together.
 * Storage keeps the view the viewer left for a reload: written as the view
 * moves, and read once, as the first Calendar under its key mounts in the
 * page — never followed while the page runs.
 *
 * Followed, storage moved the page's date alone: another page writing it — a
 * second tab on the same Calendar, the browser's own storage editor — reached
 * this page's view and never its window, which lives in the page's UI store.
 * The window then put the date back at its own first day (`useCalendarWindow`),
 * the timeline centred there and, at its window's start, re-centred a window
 * back, writing a date the other page heard in turn: a board stepped on in one
 * tab ran back a window at a time in both.
 *
 * @packageDocumentation
 */
import { CalendarLayoutType, CalendarPeriodType } from "@elaraai/e3-ui/internal";
import { usePageView } from "../shared/schedule/page-view.js";
import type { CalendarView } from "./model.js";

/**
 * The view storage keeps, read defensively — storage outlives versions, and anything may write it: an object whose
 * layout and period are cases of the Calendar's own, and whose date is a finite epoch.
 *
 * @param stored - What storage keeps under the view's key
 * @returns The view; `undefined` for anything else
 */
function calendarViewOf(stored: unknown): CalendarView | undefined {
    if (typeof stored !== "object" || stored === null) return undefined;
    const { layout, period, date } = stored as Partial<Record<keyof CalendarView, unknown>>;
    if (typeof layout !== "string" || !Object.hasOwn(CalendarLayoutType.cases, layout)) return undefined;
    if (typeof period !== "string" || !Object.hasOwn(CalendarPeriodType.cases, period)) return undefined;
    if (typeof date !== "number" || !Number.isFinite(date)) return undefined;
    return { layout: layout as CalendarView["layout"], period: period as CalendarView["period"], date };
}

/**
 * A Calendar's view, the page's own (see the module docs). Setting it keeps it for a reload; another page's keeping it
 * moves nothing here.
 *
 * @param key - The view's storage key
 * @param initial - The author's view: what a page with nothing held and nothing kept opens on
 * @returns The view, and what moves it
 */
export function useCalendarView(key: string, initial: CalendarView): { view: CalendarView; setView: (next: CalendarView) => void } {
    return usePageView(key, initial, calendarViewOf);
}
