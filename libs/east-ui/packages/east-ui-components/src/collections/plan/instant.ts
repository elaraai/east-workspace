/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's instant vocabulary, decoded (#631) — the one place the three
 * axis arms (`time` / `number` / `ordinal`) are read as NUMBERS for ordering
 * and grouping, or built as real East values. Everything geometric goes
 * through the scale (`scale.ts`); these helpers are what the scale, the
 * renderer-side derivations (`model.ts`) and the DnD slot encoding share.
 *
 * @packageDocumentation
 */

import { DateTimeType, FloatType, equalFor, parseFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";

/** One decoded instant — `{ time | number | ordinal }` (derived from the East type, never mirrored). */
export type PlanInstantValue = ValueTypeOf<typeof Plan.Types.Instant>;

/** Whether two instants are alike — the same arm and the same East value. */
export const equalInstants: (a: PlanInstantValue, b: PlanInstantValue) => boolean = equalFor(Plan.Types.Instant);

const printTime = printFor(DateTimeType);
const printNumber = printFor(FloatType);
const readTime = parseFor(DateTimeType);
const readNumber = parseFor(FloatType);

/** The axis kinds — the arms of {@link PlanInstantValue}. */
export type PlanAxisKind = PlanInstantValue["type"];

/** A `time` instant — a REAL East variant value (`variant`, never a `{ type, value }` literal). */
export function timeInstant(d: Date): PlanInstantValue {
    return variant("time", d) as PlanInstantValue;
}

/** A `number` instant. */
export function numberInstant(n: number): PlanInstantValue {
    return variant("number", n) as PlanInstantValue;
}

/** An `ordinal` instant. */
export function ordinalInstant(s: string): PlanInstantValue {
    return variant("ordinal", s) as PlanInstantValue;
}

/**
 * The instant as a comparable number ON ITS OWN ARM — epoch ms for `time`,
 * the value for `number`, the declared INDEX for `ordinal` (`NaN` when the
 * value is not in the declared list, or no list is given). Comparing two
 * instants of different arms is meaningless; callers hold the arm against
 * the axis first.
 *
 * @param t - The instant
 * @param ordinal - The ordinal axis's value → index map, when known
 * @returns The comparable number, or `NaN`
 */
export function instantOrder(t: PlanInstantValue, ordinal?: ReadonlyMap<string, number>): number {
    switch (t.type) {
        case "time": return t.value.getTime();
        case "number": return t.value;
        case "ordinal": return ordinal?.get(t.value) ?? NaN;
    }
}

/**
 * A stable identity for grouping cells by instant — its arm and its value as
 * East prints it (`time:2026-01-05T00:00:00.000`, `number:3.0`,
 * `ordinal:P1`): two instants that name the same bucket share a key.
 *
 * @param t - The instant
 * @returns The grouping key
 */
export function instantKey(t: PlanInstantValue): string {
    switch (t.type) {
        case "time": return `time:${printTime(t.value)}`;
        case "number": return `number:${printNumber(t.value)}`;
        case "ordinal": return `ordinal:${t.value}`;
    }
}

/**
 * The instant a {@link instantKey} names — its inverse, read with East's
 * parsers, so an element can carry its instant in a DOM attribute and the
 * canvas read it back (#816: a cell's `data-cell`).
 *
 * @param key - A key `instantKey` produced
 * @returns The instant, or `undefined` for a string no instant produces
 */
export function instantOfKey(key: string): PlanInstantValue | undefined {
    const colon = key.indexOf(":");
    if (colon < 0) return undefined;
    const arm = key.slice(0, colon);
    const rest = key.slice(colon + 1);
    switch (arm) {
        case "time": {
            const read = readTime(rest);
            return read.success ? timeInstant(read.value) : undefined;
        }
        case "number": {
            const read = readNumber(rest);
            return read.success ? numberInstant(read.value) : undefined;
        }
        case "ordinal":
            return ordinalInstant(rest);
        default:
            return undefined;
    }
}
