/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Calendar's view — its layout, its period and its date — the page's own
 * (#1398): held beside the date window its event sources hold, for as long as
 * the page's UI store holds that window, so a step writes the two together and
 * every render reads them together. Storage keeps the view the viewer left for
 * a reload: written as the view moves, and read once, as the first Calendar
 * under its key mounts in the page — never followed while the page runs.
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
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { CalendarLayoutType, CalendarPeriodType } from "@elaraai/e3-ui/internal";
import type { UIStoreInterface } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import type { CalendarView } from "./model.js";

/** A Calendar's view as its page holds it, and what hears it move. */
interface HeldView {
    view: CalendarView;
    readonly listeners: Set<() => void>;
}

/** Each page's Calendars' views, by the UI store their windows live in, then by their storage key: they go as it goes. */
const pages = new WeakMap<UIStoreInterface, Map<string, HeldView>>();

/**
 * The view storage keeps under a key, read defensively — storage outlives versions, and anything may write it: an
 * object whose layout and period are cases of the Calendar's own, and whose date is a finite epoch.
 *
 * @param key - The storage key
 * @returns The view; `undefined` for nothing kept, or anything else kept there
 */
function stored(key: string): CalendarView | undefined {
    let text: string | null;
    try { text = localStorage.getItem(key); } catch { return undefined; }
    if (text === null) return undefined;
    let kept: unknown;
    try { kept = JSON.parse(text); } catch { return undefined; }
    if (typeof kept !== "object" || kept === null) return undefined;
    const { layout, period, date } = kept as Partial<Record<keyof CalendarView, unknown>>;
    if (typeof layout !== "string" || !Object.hasOwn(CalendarLayoutType.cases, layout)) return undefined;
    if (typeof period !== "string" || !Object.hasOwn(CalendarPeriodType.cases, period)) return undefined;
    if (typeof date !== "number" || !Number.isFinite(date)) return undefined;
    return { layout: layout as CalendarView["layout"], period: period as CalendarView["period"], date };
}

/**
 * A Calendar's view in a page: the one its page holds already, else the one storage keeps, else the author's.
 *
 * @param store - The page's UI store
 * @param key - The view's storage key
 * @param initial - The author's view
 * @returns The page's view
 */
function heldIn(store: UIStoreInterface, key: string, initial: CalendarView): HeldView {
    let views = pages.get(store);
    if (views === undefined) { views = new Map(); pages.set(store, views); }
    let held = views.get(key);
    if (held === undefined) {
        held = { view: stored(key) ?? initial, listeners: new Set() };
        views.set(key, held);
    }
    return held;
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
    const store = getStore();
    // The author's view is a page's first only: once the page holds a view, it is the page's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const held = useMemo(() => heldIn(store, key, initial), [store, key]);
    const subscribe = useCallback((cb: () => void) => {
        held.listeners.add(cb);
        return () => { held.listeners.delete(cb); };
    }, [held]);
    const get = useCallback(() => held.view, [held]);
    const view = useSyncExternalStore(subscribe, get, get);
    const setView = useCallback((next: CalendarView) => {
        held.view = next;
        // Storage may be unavailable (private browsing, a full quota): the page keeps its view, and a reload starts from the author's.
        try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* the page's view stands */ }
        for (const cb of [...held.listeners]) cb();
    }, [held, key]);
    return { view, setView };
}
