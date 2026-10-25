/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the timeline shows, followed as it scrolls (#1398, CL9), in stores of
 * their own, each read only by what needs it, so a scroll draws nothing else
 * of the Calendar:
 *
 * - **the days it shows**, published only as the view crosses a day, read by
 *   what says them — the navigator's date and label, the count, the overlaps
 *   chip, each row's booked hours and the inspector's overlaps — so a day
 *   crossed draws only those; a figure over them is said once what the
 *   timeline draws covers them (`coversShown`), and counts only what it draws;
 * - **which way it travels** along time — as it scrolls, or as a step of its
 *   dates moved it — published only as that turns, read by the window's read
 *   alone: once the window lands, the next window of its grid that way is read
 *   ahead (ruled 25 Oct 2026).
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { scheduleOverlapMeets, scheduleOverlapsIn, type ScheduleItemValue, type ScheduleOverlaps } from "../shared/schedule/overlaps.js";
import { DAY, dayStart, type CalendarRange } from "./model.js";

/** What a timeline shows, in whole days: the first day it shows, the day after the last, and the day under its centre. */
export interface VisibleDays {
    /** The first day shown. */
    readonly from: Date;
    /** The day after the last shown. */
    readonly to: Date;
    /** The day under the view's centre, as an epoch: what the navigation steps from. */
    readonly center: number;
}

/** The days a timeline shows, as a store. */
export interface VisibleDaysStore {
    /** The days shown now; `undefined` before the timeline has laid out. */
    readonly get: () => VisibleDays | undefined;
    /** Publish what the view shows now, exactly: its readers hear only as a day it shows, or the one under its centre, moves. */
    readonly show: (visible: CalendarRange) => void;
    /** Hears each move. */
    readonly subscribe: (cb: () => void) => () => void;
}

/**
 * What a timeline's exact view shows in whole days: from the day its first
 * instant falls in to the day after the one its last falls in.
 *
 * @param visible - The view's span, exactly
 * @returns Its days, and the day under its centre
 */
export function visibleDaysOf(visible: CalendarRange): VisibleDays {
    const from = dayStart(visible.from.getTime());
    const to = new Date(dayStart(visible.to.getTime() - 1).getTime() + DAY);
    return { from, to, center: dayStart((visible.from.getTime() + visible.to.getTime()) / 2).getTime() };
}

/**
 * A store of the days a timeline shows.
 *
 * @returns The store, empty
 */
export function createVisibleDays(): VisibleDaysStore {
    let shown: VisibleDays | undefined;
    const listeners = new Set<() => void>();
    return {
        get: () => shown,
        show(visible) {
            const next = visibleDaysOf(visible);
            if (shown !== undefined && shown.from.getTime() === next.from.getTime() && shown.to.getTime() === next.to.getTime() && shown.center === next.center) return;
            shown = next;
            for (const cb of [...listeners]) cb();
        },
        subscribe(cb) {
            listeners.add(cb);
            return () => { listeners.delete(cb); };
        },
    };
}

/**
 * The days a timeline shows, read by what says them: drawn again only as they move.
 *
 * @param store - The store; `undefined` outside the timeline
 * @returns The days shown; `undefined` before the timeline has laid out, or outside it
 */
export function useVisibleDays(store: VisibleDaysStore | undefined): VisibleDays | undefined {
    return useSyncExternalStore(store?.subscribe ?? NOTHING, store?.get ?? NONE, store?.get ?? NONE);
}

/** Nothing to hear: outside the timeline. */
const NOTHING = () => () => {};
/** Nothing shown: outside the timeline. */
const NONE = (): VisibleDays | undefined => undefined;

/**
 * Whether what a timeline draws covers the days it shows (#1398): the days
 * shown, cut to the window, inside the span its events were read over. Once
 * the window is read it covers them; while a re-centre's window is read, the
 * held read covers them as long as the view has not passed beyond it.
 *
 * @param covered - The span the events drawn were read over; `undefined` while none are
 * @param range - The window shown
 * @param shown - The days shown; `undefined` before the timeline has laid out — the window, whole
 * @returns Whether every day shown is read
 */
export function coversShown(covered: CalendarRange | undefined, range: CalendarRange, shown: VisibleDays | undefined): boolean {
    if (covered === undefined) return false;
    const from = Math.max(range.from.getTime(), (shown?.from ?? range.from).getTime());
    const to = Math.min(range.to.getTime(), (shown?.to ?? range.to).getTime());
    return covered.from.getTime() <= from && to <= covered.to.getTime();
}

/**
 * The overlaps among what a timeline draws that fall in the days it shows
 * (#1398): what its overlaps chip counts and its inspector lists, moving as
 * days come into view, never as its window moves. Outside the timeline, or
 * before it has laid out, every one.
 *
 * @param overlaps - The overlaps among the events drawn
 * @param store - The days the timeline shows; `undefined` outside it
 * @returns Those overlaps
 */
export function useShownOverlaps<I extends ScheduleItemValue>(overlaps: ScheduleOverlaps<I>, store: VisibleDaysStore | undefined): ScheduleOverlaps<I> {
    const shown = useVisibleDays(store);
    return useMemo(() => shown === undefined ? overlaps : scheduleOverlapsIn(overlaps, shown.from, shown.to), [overlaps, shown]);
}

/**
 * Whether there is an overlap to show (#1398): outside the timeline, any; on
 * it, any that falls in the days it shows, once what it draws covers them. A
 * frame reads it as the days move, and draws again only as it turns.
 *
 * @param overlaps - The overlaps among the events drawn
 * @param store - The days the timeline shows; `undefined` outside it
 * @param covered - The span the events drawn were read over (`coversShown`)
 * @param range - The window shown
 * @returns Whether one shows
 */
export function useOverlapsShown<I extends ScheduleItemValue>(overlaps: ScheduleOverlaps<I>, store: VisibleDaysStore | undefined,
    covered: CalendarRange | undefined, range: CalendarRange): boolean {
    const get = useCallback(() => {
        if (store === undefined) return overlaps.pairs.length > 0;
        const shown = store.get();
        if (!coversShown(covered, range, shown)) return false;
        const from = shown?.from ?? range.from, to = shown?.to ?? range.to;
        return overlaps.pairs.some(pair => scheduleOverlapMeets(pair, from, to));
    }, [store, overlaps, covered, range]);
    return useSyncExternalStore(store?.subscribe ?? NOTHING, get, get);
}

/** Which way along time a timeline's view last travelled: back (-1), on (1), or not since a layout or a period placed it (0). */
export type Travel = -1 | 0 | 1;

/** Which way a timeline's view travels, as a store: set by its scroll and by a step of its dates, read by what reads ahead. */
export interface TravelStore {
    /** Which way it travels now. */
    readonly get: () => Travel;
    /** Publish which way it travels: its readers hear only as that turns. */
    readonly set: (toward: Travel) => void;
    /** Hears each turn. */
    readonly subscribe: (cb: () => void) => () => void;
}

/**
 * A store of which way a timeline's view travels.
 *
 * @returns The store, travelling neither way
 */
export function createTravel(): TravelStore {
    let toward: Travel = 0;
    const listeners = new Set<() => void>();
    return {
        get: () => toward,
        set(next) {
            if (next === toward) return;
            toward = next;
            for (const cb of [...listeners]) cb();
        },
        subscribe(cb) {
            listeners.add(cb);
            return () => { listeners.delete(cb); };
        },
    };
}

/** No travel: outside the timeline. */
const STILL = (): Travel => 0;

/**
 * Which way a timeline's view travels, read by what reads ahead: drawn again only as it turns.
 *
 * @param store - The store; `undefined` outside the timeline
 * @returns Which way: 0 outside the timeline
 */
export function useTravel(store: TravelStore | undefined): Travel {
    return useSyncExternalStore(store?.subscribe ?? NOTHING, store?.get ?? STILL, store?.get ?? STILL);
}
