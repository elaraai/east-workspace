/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where an element lands when it is moved, resized or drawn on a scale (#825,
 * #1148). This is pure arithmetic, shared by the pointer, the keyboard and the
 * tests of every canvas whose elements move along an axis: Plan's canvas, and
 * the Calendar's views.
 *
 * An element moves by whole UNITS: the buckets the pointer crossed since the
 * press (the bucket it is over, less the bucket it was grabbed in), or under
 * Shift one finer unit, the scale's `fineUnit` (a day under a week, month,
 * quarter or year; an hour under a day; fifteen minutes under an hour). A
 * scale whose bucket is its step has no finer unit, so Shift changes nothing
 * there. Both ends shift by the same amount, so an element keeps its place in
 * its bucket and its length: by the calendar on a time scale (a month on from
 * the 31st lands on a shorter month's last day), by the step on a number axis,
 * and by position on a list, where the whole element stays inside the list.
 *
 * A resize moves one end, never past the other: an element keeps at least one
 * unit (where an end names the last bucket it covers, one bucket). An element
 * drawn across empty time takes the units from the press to the pointer, at
 * least one.
 *
 * The rest of a drag is the drag layer's (east-ui-components, #608), which
 * every canvas rides: the 4px before it starts, Escape, the ghost and its
 * caption, and the target's refusal, asked where the drag rests and again of
 * the drop.
 *
 * @packageDocumentation
 */

import { clampedBucketAt, type Scale } from "./scale.js";

/** An element's extent: a span's two ends, or a point element's instant twice. */
export interface Span<I> {
    readonly start: I;
    readonly end: I;
}

/** What a gesture moves: the whole element, or one of its ends. */
export type MoveMode = "move" | "start" | "end";

/**
 * Whether the scale has a unit finer than its bucket: a time scale does, and a
 * scale whose bucket is its step does not.
 *
 * @param scale - The scale
 * @returns Whether Shift moves by a finer unit
 */
export function hasFineUnit<I, K extends string>(scale: Scale<I, K>): boolean {
    return scale.fineUnit !== undefined;
}

/** A time scale's domain number (epoch ms) at a window fraction. */
function domainAt<I, K extends string>(scale: Scale<I, K>, frac: number): number {
    const min = scale.toNumber(scale.window.min);
    const max = scale.toNumber(scale.window.max);
    return min + frac * (max - min);
}

/**
 * How many units lie between the press and the pointer: whole buckets, or the
 * scale's finer units under Shift.
 *
 * @param scale - The scale
 * @param grabFrac - Where the element was pressed, as a window fraction
 * @param frac - Where the pointer is now
 * @param fine - Whether Shift is held
 * @returns The signed count of units
 */
export function unitsBetween<I, K extends string>(scale: Scale<I, K>, grabFrac: number, frac: number, fine: boolean): number {
    const unit = scale.fineUnit;
    if (fine && unit !== undefined) {
        return Math.floor(domainAt(scale, frac) / unit) - Math.floor(domainAt(scale, grabFrac) / unit);
    }
    return clampedBucketAt(scale, frac) - clampedBucketAt(scale, grabFrac);
}

/**
 * An element moved `k` units, both ends shifted alike. On a list the move
 * stops where the element's first or last end meets the list's edge.
 *
 * @param scale - The scale
 * @param span - The element's extent
 * @param k - The signed number of units
 * @param fine - Whether the unit is Shift's finer one
 * @returns The extent it lands at
 */
export function moveSpan<I, K extends string>(scale: Scale<I, K>, span: Span<I>, k: number, fine: boolean): Span<I> {
    let units = k;
    if (scale.bounded) {
        const s = scale.toNumber(span.start);
        const e = scale.toNumber(span.end);
        if (!Number.isFinite(s) || !Number.isFinite(e)) return span;
        units = Math.max(-Math.min(s, e), Math.min(scale.buckets.length - 1 - Math.max(s, e), units));
    }
    return { start: scale.shift(span.start, units, fine), end: scale.shift(span.end, units, fine) };
}

/**
 * An element resized: one end moved `k` units, never past the other, so it
 * keeps at least one unit (where an end names its last bucket, one bucket).
 *
 * @param scale - The scale
 * @param span - The element's extent
 * @param edge - The end that moves
 * @param k - The signed number of units
 * @param fine - Whether the unit is Shift's finer one
 * @returns The extent it takes
 */
export function resizeSpan<I, K extends string>(scale: Scale<I, K>, span: Span<I>, edge: "start" | "end", k: number, fine: boolean): Span<I> {
    const order = (t: I) => scale.toNumber(t);
    // An end that names its last bucket makes one bucket start = end.
    const unit = scale.endInclusive ? 0 : 1;
    if (edge === "end") {
        const moved = moveSpan(scale, { start: span.end, end: span.end }, k, fine).end;
        const least = scale.shift(span.start, unit, fine);
        return { start: span.start, end: order(moved) < order(least) ? least : moved };
    }
    const moved = moveSpan(scale, { start: span.start, end: span.start }, k, fine).start;
    const most = scale.shift(span.end, -unit, fine);
    return { start: order(moved) > order(most) ? most : moved, end: span.end };
}

/**
 * Where a pointer gesture lands: the element moved, or one of its ends, by the
 * units between the press and the pointer.
 *
 * @param scale - The scale
 * @param span - The element's extent when it was pressed
 * @param mode - What the gesture moves
 * @param grabFrac - Where it was pressed, as a window fraction
 * @param frac - Where the pointer is now
 * @param fine - Whether Shift is held
 * @returns The proposed extent
 */
export function proposeAt<I, K extends string>(
    scale: Scale<I, K>, span: Span<I>, mode: MoveMode, grabFrac: number, frac: number, fine: boolean,
): Span<I> {
    const k = unitsBetween(scale, grabFrac, frac, fine);
    return mode === "move" ? moveSpan(scale, span, k, fine) : resizeSpan(scale, span, mode, k, fine);
}

/**
 * Where a keyboard step lands: the element moved, or one of its ends, one
 * bucket per step.
 *
 * @param scale - The scale
 * @param span - The element's extent now
 * @param mode - What the step moves
 * @param k - The signed number of buckets
 * @returns The proposed extent
 */
export function stepSpan<I, K extends string>(scale: Scale<I, K>, span: Span<I>, mode: MoveMode, k: number): Span<I> {
    return mode === "move" ? moveSpan(scale, span, k, false) : resizeSpan(scale, span, mode, k, false);
}

/**
 * The extent a drag across empty time draws: from the unit under the press to
 * the unit under the pointer, both whole, whichever way the drag went, and at
 * least one unit. A unit is a bucket, or the scale's finer unit under Shift
 * (`fine`): a calendar's time grid, its buckets hours, draws in quarter hours.
 * Either end stays inside the units the scale covers.
 *
 * @param scale - The scale
 * @param pressFrac - Where the drag was pressed, as a window fraction
 * @param frac - Where the pointer is now
 * @param fine - Whether to draw in the finer unit
 * @returns The extent the drag draws
 */
export function drawSpan<I, K extends string>(scale: Scale<I, K>, pressFrac: number, frac: number, fine: boolean): Span<I> {
    const unit = scale.fineUnit;
    if (fine && unit !== undefined) {
        // The units the scale covers: from its window's start to its last
        // bucket's end, both on unit edges (a bucket edge always is one).
        const first = Math.ceil(scale.toNumber(scale.window.min) / unit);
        const last = Math.floor(scale.toNumber(scale.buckets[scale.buckets.length - 1]!.end) / unit) - 1;
        const unitAt = (f: number) => Math.max(first, Math.min(last, Math.floor(domainAt(scale, f) / unit)));
        const a = unitAt(pressFrac);
        const b = unitAt(frac);
        return { start: scale.fromNumber(Math.min(a, b) * unit), end: scale.fromNumber((Math.max(a, b) + 1) * unit) };
    }
    const a = clampedBucketAt(scale, pressFrac);
    const b = clampedBucketAt(scale, frac);
    return { start: scale.buckets[Math.min(a, b)]!.start, end: scale.buckets[Math.max(a, b)]!.end };
}

/**
 * An extent as window fractions, clamped to the window: where a landing band
 * or a ghost draws it.
 *
 * @param scale - The scale
 * @param span - The extent
 * @returns Its left and right edges, 0–1
 */
export function spanFracs<I, K extends string>(scale: Scale<I, K>, span: Span<I>): { left: number; right: number } {
    const left = Math.max(0, Math.min(1, scale.fracOf(span.start)));
    const right = Math.max(left, Math.min(1, scale.endFracOf(span.end)));
    return { left, right };
}
