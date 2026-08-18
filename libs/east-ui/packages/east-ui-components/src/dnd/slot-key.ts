/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Slot-key encoding for temporal drag targets — the one place a `Date` becomes
 * a `CellRefType.slot` string.
 *
 * The grammar (`contracts/drag.ts`) says a target documents how its grid
 * coordinates encode into `row` / `slot`, and that "datetimes [are printed] as
 * the snapped ISO-8601 instant". Two targets are temporal — Gantt and Plan —
 * and they must agree on the spelling, because a host that parses one target's
 * slot parses the other's the same way.
 *
 * @packageDocumentation
 */

/**
 * Encode an instant as a drag-grammar slot key.
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
