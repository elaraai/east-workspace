/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a moved or resized element lands (#825) — pure arithmetic over the
 * canvas's one scale, shared by the pointer, the keyboard and the tests.
 *
 * An element moves by whole UNITS: the buckets the pointer crossed since the
 * press (the bucket it is over, less the bucket it was grabbed in), or with
 * Shift on a time axis one finer calendar unit — a day under a week, month,
 * quarter or year, an hour under a day, fifteen minutes under an hour. A
 * number or an ordinal axis's bucket is already its step, so Shift changes
 * nothing there. Both ends shift by the same amount, so an element keeps its
 * place within its bucket and its length: on a time axis by the calendar (a
 * month forward from the 31st lands on the last day of a shorter month), on a
 * number axis by the step, on an ordinal axis by position in the list — where
 * the whole element stays inside the list.
 *
 * A resize moves one end, never past the other: an element keeps at least
 * one unit (on an ordinal axis, where an end names the last bucket it covers,
 * one bucket).
 *
 * @packageDocumentation
 */

import type { PlanResolution, PlanScale } from "../scale.js";
import { timeInstant, type PlanInstantValue } from "../instant.js";
import { toPlanSlot } from "../slot.js";

/** An element's extent — a run's or a chip's two ends; a tile's or a mark's instant, twice. */
export interface PlanSpan {
    readonly start: PlanInstantValue;
    readonly end: PlanInstantValue;
}

/** What a gesture moves — the whole element, or one of its ends. */
export type PlanMoveMode = "move" | "start" | "end";

/** The finer unit Shift moves by on a time axis, in ms, per resolution (#825). */
const FINE_MS: Readonly<Record<PlanResolution, number>> = {
    hour: 15 * 60_000,
    day: 3_600_000,
    week: 86_400_000,
    month: 86_400_000,
    quarter: 86_400_000,
    year: 86_400_000,
};

/**
 * Whether the scale has a unit finer than its bucket — a time axis does; a
 * number or ordinal axis's bucket is its step.
 *
 * @param scale - The shared scale
 * @returns Whether Shift moves by a finer unit
 */
export function hasFineUnit(scale: PlanScale): boolean {
    return scale.kind === "time" && scale.resolution !== undefined;
}

/** The bucket a window fraction falls in, clamped into the buckets the scale covers. */
function bucketAt(scale: PlanScale, frac: number): number {
    const last = scale.buckets.length - 1;
    const covered = scale.buckets[last]!.x1;
    const f = Math.max(0, Math.min(covered, Number.isFinite(frac) ? frac : 0));
    const i = scale.bucketAtFrac(f);
    return i >= 0 ? i : f <= 0 ? 0 : last;
}

/** The time axis's domain number (epoch ms) at a window fraction. */
function msAt(scale: PlanScale, frac: number): number {
    const min = scale.toNumber(scale.window.min);
    const max = scale.toNumber(scale.window.max);
    return min + frac * (max - min);
}

/**
 * How many units lie between the press and the pointer — whole buckets, or
 * finer units under Shift on a time axis.
 *
 * @param scale - The shared scale
 * @param grabFrac - Where the element was pressed, as a window fraction
 * @param frac - Where the pointer is now, as a window fraction
 * @param fine - Whether Shift is held
 * @returns The signed count of units
 */
export function unitsBetween(scale: PlanScale, grabFrac: number, frac: number, fine: boolean): number {
    if (fine && hasFineUnit(scale)) {
        const ms = FINE_MS[scale.resolution!];
        return Math.floor(msAt(scale, frac) / ms) - Math.floor(msAt(scale, grabFrac) / ms);
    }
    return bucketAt(scale, frac) - bucketAt(scale, grabFrac);
}

/**
 * A UTC date `months` calendar months on, its day clamped to the target
 * month's last — Jan 31 plus one month is Feb 28 (or 29), never Mar 3.
 *
 * @param d - The date
 * @param months - The signed number of months
 * @returns The date
 */
export function addMonthsClamped(d: Date, months: number): Date {
    const total = d.getUTCMonth() + months;
    const year = d.getUTCFullYear() + Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(
        year, month, Math.min(d.getUTCDate(), days),
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds(),
    ));
}

/** A UTC date `k` of a resolution's periods on — by the calendar. */
function shiftCalendar(d: Date, res: PlanResolution, k: number): Date {
    switch (res) {
        case "hour": return new Date(d.getTime() + k * 3_600_000);
        case "day": return new Date(d.getTime() + k * 86_400_000);
        case "week": return new Date(d.getTime() + k * 7 * 86_400_000);
        case "month": return addMonthsClamped(d, k);
        case "quarter": return addMonthsClamped(d, 3 * k);
        case "year": return addMonthsClamped(d, 12 * k);
    }
}

/**
 * An instant `k` units on — whole buckets, or finer units under Shift.
 *
 * @param scale - The shared scale
 * @param t - The instant
 * @param k - The signed number of units
 * @param fine - Whether the unit is Shift's finer one (a time axis only)
 * @returns The instant — itself when it rides another arm than the scale
 */
export function shiftInstant(scale: PlanScale, t: PlanInstantValue, k: number, fine: boolean): PlanInstantValue {
    if (k === 0 || t.type !== scale.kind) return t;
    if (t.type === "time") {
        const res = scale.resolution;
        if (res === undefined) return t;
        return timeInstant(fine ? new Date(t.value.getTime() + k * FINE_MS[res]) : shiftCalendar(t.value, res, k));
    }
    // A number axis moves by its step; an ordinal one by position in the list.
    return scale.offset(t, k);
}

/**
 * An element moved `k` units — both ends shifted alike. On an ordinal axis the
 * move stops where the element's first or last end meets the list's edge.
 *
 * @param scale - The shared scale
 * @param span - The element's extent
 * @param k - The signed number of units
 * @param fine - Whether the unit is Shift's finer one
 * @returns The extent it lands at
 */
export function moveSpan(scale: PlanScale, span: PlanSpan, k: number, fine: boolean): PlanSpan {
    let units = k;
    if (scale.kind === "ordinal") {
        const s = scale.toNumber(span.start);
        const e = scale.toNumber(span.end);
        if (!Number.isFinite(s) || !Number.isFinite(e)) return span;
        units = Math.max(-Math.min(s, e), Math.min(scale.buckets.length - 1 - Math.max(s, e), units));
    }
    return { start: shiftInstant(scale, span.start, units, fine), end: shiftInstant(scale, span.end, units, fine) };
}

/**
 * An element resized — one end moved `k` units, never past the other: it
 * keeps at least one unit (on an ordinal axis, one bucket).
 *
 * @param scale - The shared scale
 * @param span - The element's extent
 * @param edge - The end that moves
 * @param k - The signed number of units
 * @param fine - Whether the unit is Shift's finer one
 * @returns The extent it takes
 */
export function resizeSpan(scale: PlanScale, span: PlanSpan, edge: "start" | "end", k: number, fine: boolean): PlanSpan {
    const order = (t: PlanInstantValue) => scale.toNumber(t);
    // An ordinal end names the last bucket covered, so one bucket is start = end.
    const unit = scale.kind === "ordinal" ? 0 : 1;
    if (edge === "end") {
        const moved = moveSpan(scale, { start: span.end, end: span.end }, k, fine).end;
        const least = shiftInstant(scale, span.start, unit, fine);
        return { start: span.start, end: order(moved) < order(least) ? least : moved };
    }
    const moved = moveSpan(scale, { start: span.start, end: span.start }, k, fine).start;
    const most = shiftInstant(scale, span.end, -unit, fine);
    return { start: order(moved) > order(most) ? most : moved, end: span.end };
}

/**
 * Where a pointer gesture lands — the element moved, or one end, by the units
 * between the press and the pointer.
 *
 * @param scale - The shared scale
 * @param span - The element's extent when it was pressed
 * @param mode - What the gesture moves
 * @param grabFrac - Where it was pressed, as a window fraction
 * @param frac - Where the pointer is now
 * @param fine - Whether Shift is held
 * @returns The proposed extent
 */
export function proposeAt(
    scale: PlanScale, span: PlanSpan, mode: PlanMoveMode, grabFrac: number, frac: number, fine: boolean,
): PlanSpan {
    const k = unitsBetween(scale, grabFrac, frac, fine);
    return mode === "move" ? moveSpan(scale, span, k, fine) : resizeSpan(scale, span, mode, k, fine);
}

/**
 * Where a keyboard step lands — the element moved, or one end, one bucket.
 *
 * @param scale - The shared scale
 * @param span - The element's extent now
 * @param mode - What the step moves
 * @param k - The signed number of buckets
 * @returns The proposed extent
 */
export function stepSpan(scale: PlanScale, span: PlanSpan, mode: PlanMoveMode, k: number): PlanSpan {
    return mode === "move" ? moveSpan(scale, span, k, false) : resizeSpan(scale, span, mode, k, false);
}

/**
 * The slot a drag grammar names for an instant (#631) — the start of the
 * bucket it falls in, the window's first or last bucket when it lies beyond.
 *
 * @param scale - The shared scale
 * @param t - The instant
 * @returns The slot key
 */
export function slotOfInstant(scale: PlanScale, t: PlanInstantValue): string {
    const i = scale.bucketOf(t);
    const first = scale.buckets[0]!;
    const bucket = i >= 0 ? scale.buckets[i]!
        : scale.toNumber(t) < scale.toNumber(first.start) ? first : scale.buckets[scale.buckets.length - 1]!;
    return toPlanSlot(bucket.start);
}

/**
 * The slot an element's END lands in — the bucket of its last instant: on a
 * half-open time or number axis the bucket the end closes, on an ordinal one
 * the bucket it names.
 *
 * @param scale - The shared scale
 * @param t - The end
 * @returns The slot key
 */
export function slotOfEnd(scale: PlanScale, t: PlanInstantValue): string {
    if (scale.kind === "ordinal") return slotOfInstant(scale, t);
    const i = bucketAt(scale, scale.endFracOf(t) - 1e-9);
    return toPlanSlot(scale.buckets[i]!.start);
}

/**
 * An extent as window fractions, clamped to the window — where a landing band
 * draws it.
 *
 * @param scale - The shared scale
 * @param span - The extent
 * @returns Its left and right edges, 0–1
 */
export function spanFracs(scale: PlanScale, span: PlanSpan): { left: number; right: number } {
    const left = Math.max(0, Math.min(1, scale.fracOf(span.start)));
    const right = Math.max(left, Math.min(1, scale.endFracOf(span.end)));
    return { left, right };
}
