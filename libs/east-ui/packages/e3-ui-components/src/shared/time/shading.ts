/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The bands a time view shades (#1148): weekends, and the hours outside the
 * working day, as data. Each band is a stretch of the window as window
 * fractions, and its kind; the host draws it down a timeline (along x) or
 * across a day column (along y), and the host's recipe gives it its look.
 *
 * Times are UTC, as everything on a time axis is (#326): a Saturday is a UTC
 * Saturday, and a working day's hours are UTC hours. A weekend day is shaded
 * whole, never also for its hours. Bands of one kind that meet are one band,
 * so a night runs from one day's close to the next day's open, and a weekend
 * from Saturday to Monday.
 *
 * @packageDocumentation
 */

import type { TimeWindow } from "./scale.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** What a band shades. */
export type ShadeKind = "weekend" | "offHours";

/** One shaded stretch of the window. */
export interface ShadeBand {
    /** Where it starts, as a window fraction. */
    readonly start: number;
    /** How long it is, as a window fraction. */
    readonly width: number;
    /** What it shades. */
    readonly kind: ShadeKind;
}

/** What a view shades. */
export interface ShadeOptions {
    /** The working day, in whole UTC hours: the hours before `from` and from `to` on are shaded. Omitted, no hour is. */
    readonly hours?: { readonly from: number; readonly to: number } | undefined;
    /** Whether Saturdays and Sundays are shaded whole: true by default. */
    readonly weekends?: boolean | undefined;
}

/**
 * The bands a window shades (see the module docs).
 *
 * @param window - The window, `[min, max)`
 * @param options - The working day, and whether weekends shade
 * @returns The bands, in order; none for an empty window
 */
export function shadeBands(window: TimeWindow, options: ShadeOptions): ShadeBand[] {
    const min = window.min.getTime();
    const max = window.max.getTime();
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
    const weekends = options.weekends ?? true;
    const hours = options.hours;
    const spans: { from: number; to: number; kind: ShadeKind }[] = [];
    const add = (from: number, to: number, kind: ShadeKind): void => {
        const a = Math.max(from, min);
        const b = Math.min(to, max);
        if (b <= a) return;
        const last = spans[spans.length - 1];
        if (last !== undefined && last.kind === kind && last.to === a) last.to = b;
        else spans.push({ from: a, to: b, kind });
    };
    for (let day = Math.floor(min / DAY_MS) * DAY_MS; day < max; day += DAY_MS) {
        const weekday = new Date(day).getUTCDay();
        if (weekends && (weekday === 0 || weekday === 6)) {
            add(day, day + DAY_MS, "weekend");
        } else if (hours !== undefined) {
            add(day, day + Math.max(0, hours.from) * HOUR_MS, "offHours");
            add(day + Math.min(24, hours.to) * HOUR_MS, day + DAY_MS, "offHours");
        }
    }
    const span = max - min;
    return spans.map((s) => ({ start: (s.from - min) / span, width: (s.to - s.from) / span, kind: s.kind }));
}
