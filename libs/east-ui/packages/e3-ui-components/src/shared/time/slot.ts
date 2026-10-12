/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The drag grammar's slots on a scale (#631, #1148): what a
 * `CellRefType.slot` names on an axis, the start of the bucket an instant falls
 * in, spelled as the scale's kind spells it (`Scale.slotOf`). On a time scale
 * that is the instant as East prints a DateTime, the Z-less UTC ISO form a host
 * reads back with `slot.parse(DateTimeType)`, through the drag layer's shared
 * codec (`dateTimeSlot`), so every target that drops on time spells its slots
 * alike.
 *
 * @packageDocumentation
 */

import { clampedBucketAt, type Scale } from "./scale.js";

/**
 * The slot the drag grammar names for an instant: the start of the bucket it
 * falls in, or of the window's first or last bucket when it lies beyond.
 *
 * @param scale - The scale
 * @param t - The instant
 * @returns The slot key
 */
export function slotOfInstant<I, K extends string>(scale: Scale<I, K>, t: I): string {
    const i = scale.bucketOf(t);
    const first = scale.buckets[0]!;
    const bucket = i >= 0 ? scale.buckets[i]!
        : scale.toNumber(t) < scale.toNumber(first.start) ? first : scale.buckets[scale.buckets.length - 1]!;
    return scale.slotOf(bucket.start);
}

/**
 * The slot an element's END lands in: the bucket of its last instant. On a
 * half-open scale that is the bucket the end closes (an end on a bucket edge
 * is the bucket before it); where an end names its last bucket, the bucket it
 * names.
 *
 * @param scale - The scale
 * @param t - The end
 * @returns The slot key
 */
export function slotOfEnd<I, K extends string>(scale: Scale<I, K>, t: I): string {
    if (scale.endInclusive) return slotOfInstant(scale, t);
    const i = clampedBucketAt(scale, scale.endFracOf(t) - 1e-9);
    return scale.slotOf(scale.buckets[i]!.start);
}
