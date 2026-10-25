/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The days the timeline shows, followed as it scrolls (#1398, CL9): a store
 * of their own, published only as the view crosses a day, and read only by
 * what says them — the navigator's date and label, the count, each row's
 * booked hours — so a scroll draws nothing else of the Calendar, and a day
 * crossed draws only those.
 *
 * @packageDocumentation
 */

import { useSyncExternalStore } from "react";
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
