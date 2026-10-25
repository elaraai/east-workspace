/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's view (#1342, #1406): its layout, its period and its date, kept
 * per viewer. Each layout keeps its own period — Shifts a day or a week,
 * People a week or a month — so switching layouts restores the period that
 * layout had (P1); a view kept before the periods were per layout reads as
 * the defaults. The span in view follows the view: a week, or the four to six
 * weeks that touch a month (D2). The view is the page's own (#1398,
 * `shared/schedule/page-view.ts`), as the window it writes into its source
 * is: another page keeping a view moves neither, and a reload opens on the
 * view kept last.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { RosterLayoutType, RosterPeriodType } from "@elaraai/e3-ui/internal";
import { usePageView } from "../shared/schedule/page-view.js";
import { shiftCalendar } from "../shared/time/scale.js";
import {
    DAY, compareDate, dayStart, periodOf, rosterSpan, weekStart, type RosterLayout, type RosterPeriod, type RosterSpan, type RosterValue, type RosterView,
} from "./model.js";

export interface RosterWindow {
    view: RosterView; setView: (next: RosterView) => void;
    /** The span in view: its weeks, and the window its reads cover. */
    span: RosterSpan;
    /** The span's first week's first day. */
    start: Date;
    /** The day of its week the view's date is, from zero: the day the Shifts layout's Day period shows. */
    day: number;
    /** Shows a layout, with the period it last had (P1). */
    setLayout: (layout: RosterLayout) => void;
    /**
     * Shows a period of the layout in view (P3): Week → Month opens the month holding the week's fourth day; Month → Week
     * the week given, else the week Month was opened from while the month in view still holds it, else the month's first
     * whose fourth day falls in it.
     */
    setPeriod: (period: RosterPeriod, week?: Date) => void;
    /** Steps the span by its unit — a week, or a month in Month (P2). */
    step: (by: number) => void;
    /** Opens a week in the Week period, of the layout given or the one in view (P12, P24). */
    openWeek: (week: Date, layout?: RosterLayout) => void;
}

/** A view as it is kept: its period one its layout takes, whatever an older view held. */
function normal(view: RosterView): RosterView {
    const period = periodOf(view.layout, view.period);
    return period === view.period ? view : { ...view, period };
}

/**
 * The view storage keeps, read defensively — storage outlives versions, and anything may write it: an object whose
 * layout and period are cases of the Roster's own, whose date is a finite epoch, and whose periods per layout (#1406,
 * P1) are taken where each reads as one — anything else left out.
 *
 * @param stored - What storage keeps under the view's key
 * @returns The view; `undefined` for anything else
 */
function rosterViewOf(stored: unknown): RosterView | undefined {
    if (typeof stored !== "object" || stored === null) return undefined;
    const { layout, period, date, held } = stored as Partial<Record<keyof RosterView, unknown>>;
    if (typeof layout !== "string" || !Object.hasOwn(RosterLayoutType.cases, layout)) return undefined;
    if (typeof period !== "string" || !Object.hasOwn(RosterPeriodType.cases, period)) return undefined;
    if (typeof date !== "number" || !Number.isFinite(date)) return undefined;
    const periods: Partial<Record<RosterLayout, RosterPeriod>> = {};
    if (typeof held === "object" && held !== null) {
        for (const [of, was] of Object.entries(held)) {
            if (Object.hasOwn(RosterLayoutType.cases, of) && typeof was === "string" && Object.hasOwn(RosterPeriodType.cases, was)) periods[of as RosterLayout] = was as RosterPeriod;
        }
    }
    return normal({ layout: layout as RosterView["layout"], period: period as RosterView["period"], date, held: periods });
}

/**
 * The week is the Roster's own: its navigation and its picker choose it, kept per viewer (#1342: no Slice picks it), the
 * page's own while the page runs (see the module docs).
 *
 * @param value - The payload: the author's view, and the week's start
 * @param key - The Roster's storage key
 * @returns The view, what moves it, the span in view, its first day and the view's day in its week
 */
export function useRosterWindow(value: RosterValue, key: string): RosterWindow {
    const { view: kept, setView: setKept } = usePageView<RosterView>(`${key}.view`, {
        layout: value.settings.layout.type, period: periodOf(value.settings.layout.type, value.settings.period.type),
        date: dayStart(value.settings.date.type === "some" ? value.settings.date.value : new Date()).getTime(),
    }, rosterViewOf);
    const view = useMemo(() => normal(kept), [kept]);
    const sunday = value.settings.weekStart.type === "sunday";
    const span = useMemo(() => rosterSpan(view.date, view.period, sunday), [view.date, view.period, sunday]);
    const week = useMemo(() => weekStart(new Date(view.date), sunday), [view.date, sunday]);
    const day = Math.floor((dayStart(view.date).getTime() - week.getTime()) / DAY);
    const setView = useCallback((next: RosterView) => setKept(normal(next)), [setKept]);
    const setLayout = useCallback((layout: RosterLayout) => {
        if (layout === view.layout) return;
        // The layout's own period, as it last had it; the period in view kept for the layout left.
        setView({ ...view, layout, period: periodOf(layout, view.held?.[layout]), held: { ...view.held, [view.layout]: view.period } });
    }, [view, setView]);
    // The week Month was opened from (P3, ruled 26 Oct 2026): what Month → Week returns to while the month in view still
    // holds it — a viewer toggling the two keeps their place; a month stepped to opens on its own first week.
    const left = useRef<Date | undefined>(undefined);
    const setPeriod = useCallback((period: RosterPeriod, at?: Date) => {
        const next = periodOf(view.layout, period);
        if (next === view.period) return;
        let date = view.date;
        // Week → Month: the month holding the week's fourth day. Month → Week: the week given, else the week left while
        // the month holds it, else the first week of the month whose fourth day falls in it.
        if (next === "month") { left.current = week; date = week.getTime() + 3 * DAY; }
        else if (view.period === "month") {
            const month = span.month ?? span.start;
            const back = left.current;
            const first = at ?? (back !== undefined && span.weeks.some(start => compareDate(start, back) === 0) ? back : undefined)
                ?? span.weeks.find(start => compareDate(monthOf(new Date(start.getTime() + 3 * DAY)), month) === 0) ?? span.start;
            date = first.getTime();
        }
        setView({ ...view, period: next, date });
    }, [view, week, span, setView]);
    const step = useCallback((by: number) => {
        const date = view.period === "month" ? shiftCalendar(new Date(view.date), "month", by).getTime() : view.date + by * 7 * DAY;
        setView({ ...view, date });
    }, [view, setView]);
    const openWeek = useCallback((at: Date, layout: RosterLayout = view.layout) => {
        const held = layout === view.layout ? view.held : { ...view.held, [view.layout]: view.period };
        setView({ ...view, layout, period: periodOf(layout, "week"), date: at.getTime(), held });
    }, [view, setView]);
    return { view, setView, span, start: span.start, day, setLayout, setPeriod, step, openWeek };
}

/** The first day of a date's month. */
function monthOf(date: Date): Date { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)); }
