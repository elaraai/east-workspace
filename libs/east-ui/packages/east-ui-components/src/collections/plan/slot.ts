/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's drag-grammar slot keys (#631) — a bucket's start instant as a
 * `CellRefType.slot`, per the axis arm, and read back: `time` ⇒ the Z-less ISO
 * instant (`slot.parse(DateTimeType)`), `number` ⇒ the decimal form
 * (`slot.parse(FloatType)`), `ordinal` ⇒ the value itself. Composed from the
 * drag layer's shared codecs, so the Plan spells its slots as every
 * axis-bearing target does (#608 moved it here: the layer knows no Plan type).
 *
 * @packageDocumentation
 */

import { dateTimeSlot, numberSlot, stringSlot } from "../../dnd/slot-key.js";
import { numberInstant, ordinalInstant, timeInstant, type PlanAxisKind, type PlanInstantValue } from "./instant.js";

/**
 * A Plan instant as a slot key, per its axis arm.
 *
 * @param t - The already-snapped instant (a bucket start)
 * @returns The slot key
 */
export function toPlanSlot(t: PlanInstantValue): string {
    switch (t.type) {
        case "time": return dateTimeSlot.encode(t.value);
        case "number": return numberSlot.encode(t.value);
        case "ordinal": return stringSlot.encode(t.value);
    }
}

/**
 * The Plan instant a slot key names, per the axis arm — the inverse of
 * {@link toPlanSlot}. What a dropped card's draft is made at (#880).
 *
 * @param kind - The axis kind the slot was spelled for
 * @param slot - The slot key
 * @returns The instant, or `undefined` when the text is not one of that kind
 */
export function fromPlanSlot(kind: PlanAxisKind, slot: string): PlanInstantValue | undefined {
    switch (kind) {
        case "time": {
            const d = dateTimeSlot.decode(slot);
            return d !== undefined ? timeInstant(d) : undefined;
        }
        case "number": {
            const n = numberSlot.decode(slot);
            return n !== undefined ? numberInstant(n) : undefined;
        }
        case "ordinal": {
            const s = stringSlot.decode(slot);
            return s !== undefined ? ordinalInstant(s) : undefined;
        }
    }
}
