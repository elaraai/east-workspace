/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Slot-key codecs for axis-bearing drag targets — how a coordinate that is
 * not a string becomes a `CellRefType.slot`, and is read back.
 *
 * The grammar (`contracts/drag.ts`) says a target documents how its grid
 * coordinates encode into `row` / `slot`, and that coordinates that are not
 * strings print canonically: datetimes as the snapped ISO-8601 instant,
 * numbers in their decimal form. Every axis-bearing target must spell them
 * alike, because a host that parses one target's slot parses another's the
 * same way. A target composes its own coordinate's codec from these (the
 * Plan's instant codec lives with the Plan, #608) — the drag layer knows no
 * target's types.
 *
 * @packageDocumentation
 */

import { DateTimeType, FloatType, parseFor } from "@elaraai/east";

/** A coordinate's spelling as a slot key, and its reading back. */
export interface SlotCodec<T> {
    /** The slot key a coordinate is spelled as. */
    encode(value: T): string;
    /** The coordinate a slot key names — `undefined` for text it does not read. */
    decode(slot: string): T | undefined;
}

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

/** A datetime's slot key — the Z-less ISO instant, read as East reads it (`slot.parse(DateTimeType)`). */
export const dateTimeSlot: SlotCodec<Date> = {
    encode: toEastDateTimeSlot,
    decode: (slot) => {
        const parsed = parseDateTimeSlot(slot);
        return parsed.success ? parsed.value : undefined;
    },
};

/** A number's slot key — its decimal form, read as East reads it (`slot.parse(FloatType)`). */
export const numberSlot: SlotCodec<number> = {
    encode: (n) => String(n),
    decode: (slot) => {
        const parsed = parseFloatSlot(slot);
        return parsed.success ? parsed.value : undefined;
    },
};

/** A string coordinate's slot key — the string itself. */
export const stringSlot: SlotCodec<string> = {
    encode: (s) => s,
    decode: (slot) => slot,
};
