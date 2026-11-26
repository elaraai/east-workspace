/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a Plan's horizon bars hold, worked out from the events themselves
 * (#1732): each event's span — from rows timed by Option<DateTime> fields, by
 * DateTime fields, or an instant — and each period's count of the events that
 * touch it, the oracle a test holds the strip's bars to, and a group's own
 * row's counts (#1716).
 *
 * @packageDocumentation
 */

import type { option } from "@elaraai/east";

/** An event's `[start, end)`, in ms: an instant's, and one ending at or before its start, `[at, at]`. */
export type Span = readonly [number, number];

/** A span from an event's start and end: one ending at or before its start is an instant, as e3 files it. */
const spanOf = (start: number, end: number): Span => [start, Math.max(start, end)];

/**
 * The spans of rows timed by Option<DateTime> fields: a row with no start waits in the backlog, filed nowhere, and
 * one with no end is an instant.
 *
 * @param rows - The rows
 * @param times - A row's start and end
 * @returns Each scheduled row's span
 */
export function optionSpans<R>(rows: Iterable<R>, times: (row: R) => readonly [option<Date>, option<Date>]): Span[] {
    return [...rows].flatMap((row) => {
        const [start, end] = times(row);
        if (start.type !== "some") return [];
        return [spanOf(start.value.getTime(), end.type === "some" ? end.value.getTime() : start.value.getTime())];
    });
}

/**
 * The spans of rows timed by DateTime fields.
 *
 * @param rows - The rows
 * @param times - A row's start and end
 * @returns Each row's span
 */
export function spans<R>(rows: Iterable<R>, times: (row: R) => readonly [Date, Date]): Span[] {
    return [...rows].map((row) => {
        const [start, end] = times(row);
        return spanOf(start.getTime(), end.getTime());
    });
}

/**
 * The spans of rows each an instant, by its DateTime field.
 *
 * @param rows - The rows
 * @param at - A row's instant
 * @returns Each row's span
 */
export function instants<R>(rows: Iterable<R>, at: (row: R) => Date): Span[] {
    return [...rows].map((row) => spanOf(at(row).getTime(), at(row).getTime()));
}

/** A period a horizon's bars count by: a day, a week from its Monday as e3's weeks are, a month, a quarter or a year — UTC. */
export type HorizonPeriod = "day" | "week" | "month" | "quarter" | "year";

const DAY_MS = 86_400_000;

/** The start of the period holding an instant, in ms. */
function periodStart(unit: HorizonPeriod, at: number): number {
    const d = new Date(at);
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    switch (unit) {
        case "day": return day;
        case "week": return day - ((d.getUTCDay() + 6) % 7) * DAY_MS;
        case "month": return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
        case "quarter": return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
        case "year": return Date.UTC(d.getUTCFullYear(), 0, 1);
    }
}

/** The start of the period after the one starting at `start`, in ms. */
function periodNext(unit: HorizonPeriod, start: number): number {
    const d = new Date(start);
    switch (unit) {
        case "day": return start + DAY_MS;
        case "week": return start + 7 * DAY_MS;
        case "month": return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
        case "quarter": return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
        case "year": return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
    }
}

/**
 * Each period's count of the events that touch it — those starting in it, and those running into it — across a
 * horizon: from the period the first event or the axis's window begins in to the one the last event starts or the
 * window ends in. A period none touches is left out, as the strip draws no bar for it.
 *
 * @param events - Every source's events
 * @param window - The axis's stated window, `[from, to)` in ms
 * @param unit - The period the bars count by; a month unless given
 * @returns Each touched period's count, in order
 */
export function touched(events: readonly Span[], window: Span, unit: HorizonPeriod = "month"): number[] {
    const first = events.reduce((least, [start]) => Math.min(least, start), window[0]);
    const last = events.reduce((most, [start]) => Math.max(most, start), window[1] - 1);
    const expected: number[] = [];
    for (let at = periodStart(unit, first); at <= last;) {
        const next = periodNext(unit, at);
        const n = events.filter(([start, end]) => (start >= at && start < next) || (start < at && end > at)).length;
        if (n > 0) expected.push(n);
        at = next;
    }
    return expected;
}

/**
 * Each period's count of the events that touch it, as {@link touched} counts them, by the period's start: from the
 * period holding the first event's start to the one holding the last's — the oracle a group's own row's counts are
 * held to, a column at a time (#1716). A period none touches is left out, as the row draws no cell for it.
 *
 * @param events - The events beneath the row
 * @param unit - The columns' period
 * @returns Each touched period's count, by its start in ms, in order
 */
export function periodCounts(events: readonly Span[], unit: HorizonPeriod): Map<number, number> {
    const counts = new Map<number, number>();
    if (events.length === 0) return counts;
    const first = events.reduce((least, [start]) => Math.min(least, start), Infinity);
    const last = events.reduce((most, [start]) => Math.max(most, start), -Infinity);
    for (let at = periodStart(unit, first); at <= last; at = periodNext(unit, at)) {
        const next = periodNext(unit, at);
        const n = events.filter(([start, end]) => (start >= at && start < next) || (start < at && end > at)).length;
        if (n > 0) counts.set(at, n);
    }
    return counts;
}
