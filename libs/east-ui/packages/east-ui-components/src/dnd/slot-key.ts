/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Slot-key encoding for axis-bearing drag targets — the one place a Plan
 * instant becomes a `CellRefType.slot` string.
 *
 * The grammar (`contracts/drag.ts`) says a target documents how its grid
 * coordinates encode into `row` / `slot`, and that coordinates that are not
 * strings print canonically: datetimes as the snapped ISO-8601 instant,
 * numbers via their decimal form. The Plan is the axis-bearing target, and any
 * future one must agree on the spelling, because a host that parses one
 * target's slot parses the other's the same way.
 *
 * @packageDocumentation
 */

import { DateTimeType, FloatType, parseFor, variant } from "@elaraai/east";
import type { PlanAxisKind, PlanInstantValue } from "../collections/plan/instant.js";

const parseDateTimeSlot = parseFor(DateTimeType);
const parseFloatSlot = parseFor(FloatType);

/**
 * Encode a datetime instant as a drag-grammar slot key.
 *
 * @remarks
 * East's `parse(DateTimeType)` rejects `toISOString()`'s trailing `Z` (East
 * DateTimes are implicitly UTC), and the documented contract is that a temporal
 * target's slot parses as an East DateTime — so the slot carries the Z-less ISO
 * form. Callers snap the instant to their own grid FIRST; this only spells it.
 *
 * @param d - The already-snapped instant
 * @returns The slot key (`"2026-07-06T00:00:00.000"`)
 */
export const toEastDateTimeSlot = (d: Date): string => d.toISOString().slice(0, -1);

/**
 * Encode a Plan instant as a drag-grammar slot key, per its axis arm (#631):
 * `time` ⇒ the Z-less ISO instant (`slot.parse(DateTimeType)`), `number` ⇒
 * the decimal form (`slot.parse(FloatType)`), `ordinal` ⇒ the value itself.
 * The receiving series parses per the axis kind it was authored for.
 *
 * @param t - The already-snapped instant (a bucket start)
 * @returns The slot key
 */
export function toPlanSlot(t: PlanInstantValue): string {
    switch (t.type) {
        case "time": return toEastDateTimeSlot(t.value);
        case "number": return String(t.value);
        case "ordinal": return t.value;
    }
}

/**
 * Read a drag-grammar slot key back as the Plan instant it names, per the
 * axis arm — the inverse of {@link toPlanSlot}, parsed as East parses it
 * (`slot.parse(DateTimeType)` / `slot.parse(FloatType)`, or the ordinal value
 * itself). What a dropped card's draft is made at (#880).
 *
 * @param kind - The axis kind the slot was spelled for
 * @param slot - The slot key
 * @returns The instant, or `undefined` when the text is not one of that kind
 */
export function fromPlanSlot(kind: PlanAxisKind, slot: string): PlanInstantValue | undefined {
    switch (kind) {
        case "time": {
            const parsed = parseDateTimeSlot(slot);
            return parsed.success ? variant("time", parsed.value) as PlanInstantValue : undefined;
        }
        case "number": {
            const parsed = parseFloatSlot(slot);
            return parsed.success ? variant("number", parsed.value) as PlanInstantValue : undefined;
        }
        case "ordinal":
            return variant("ordinal", slot) as PlanInstantValue;
    }
}
