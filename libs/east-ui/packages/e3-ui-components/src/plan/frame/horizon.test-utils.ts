/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a Plan's horizon bars hold, worked out from the events themselves
 * (#1732): each event's span — from rows timed by Option<DateTime> fields, by
 * DateTime fields, or an instant — and each period's count of the events that
 * touch it, the oracle a test holds the strip's bars to.
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

/**
 * Each period's count of the events that touch it — those starting in it, and those running into it — across a
 * horizon: from the period the first event or the axis's window begins in to the one the last event starts or the
 * window ends in, a period `months` months long from the year's first. A period none touches is left out, as the
 * strip draws no bar for it.
 *
 * @param events - Every source's events
 * @param window - The axis's stated window, `[from, to)` in ms
 * @param months - A period's length in months: 1 for a month, 3 for a quarter, 12 for a year
 * @returns Each touched period's count, in order
 */
export function touched(events: readonly Span[], window: Span, months = 1): number[] {
    const first = events.reduce((least, [start]) => Math.min(least, start), window[0]);
    const last = events.reduce((most, [start]) => Math.max(most, start), window[1] - 1);
    const expected: number[] = [];
    const begin = new Date(first);
    for (let at = Date.UTC(begin.getUTCFullYear(), Math.floor(begin.getUTCMonth() / months) * months, 1); at <= last;) {
        const from = new Date(at);
        const next = Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1);
        const n = events.filter(([start, end]) => (start >= at && start < next) || (start < at && end > at)).length;
        if (n > 0) expected.push(n);
        at = next;
    }
    return expected;
}
