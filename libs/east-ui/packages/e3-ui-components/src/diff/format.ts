/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure helpers for formatting decoded East values into short text suitable
 * for the diff row chips. Container shapes (Struct/Array/Dict/Set/…) fall
 * through to east's canonical {@link printFor} so we never hand-roll a
 * JSON serializer.
 *
 * @packageDocumentation
 */

import { printFor, isVariant, none, some, variant, type EastTypeValue } from "@elaraai/east";
import { formatters, type Formatters, type TickFormatOpt } from "@elaraai/east-ui-components";

const MAX_INLINE_CHARS = 48;

/** A whole float keeps one decimal, so it still reads as a float (`42.0`). */
const FLOAT_WHOLE: TickFormatOpt = variant("number", { minimumFractionDigits: some(1n), maximumFractionDigits: some(1n), signDisplay: none });
/** A float of a thousand or more: two decimals at most. */
const FLOAT_LARGE: TickFormatOpt = variant("number", { minimumFractionDigits: none, maximumFractionDigits: some(2n), signDisplay: none });
/** A smaller float: four decimals at most. */
const FLOAT_SMALL: TickFormatOpt = variant("number", { minimumFractionDigits: none, maximumFractionDigits: some(4n), signDisplay: none });

/**
 * Format a decoded East value into a short human-readable string. The
 * `typeValue` selects formatting:
 * - Primitives get a per-type compact form (e.g. `"42.50"`, `"2025-01-01"`).
 * - Variants render their tag (and a printed inner for non-null cases).
 * - Containers fall through to `printFor(typeValue)(value)`.
 *
 * When `typeValue` is null we have no type to round-trip against — return
 * `"<value>"`.
 *
 * Numbers print in the app's locale (#850): an integer is data and prints
 * bare — every digit, never grouped, so an id or a year stays whole — and a
 * float with the locale's separators. A `DateTime` prints as its exact UTC
 * instant (ISO), because a diff must show what differs, to the millisecond.
 *
 * @param typeValue - The leaf's East type, when known
 * @param value - The decoded value
 * @param words - The formatters numbers print through; the runtime locale's
 *   when omitted
 * @returns The short text
 */
export function formatLeafValue(typeValue: EastTypeValue | null, value: any, words: Formatters = formatters()): string {
    if (value === null || value === undefined) return "null";
    if (!typeValue) return "<value>";

    switch (typeValue.type) {
        case "Null":     return "null";
        case "Boolean":  return value ? "true" : "false";
        case "Integer":  return typeof value === "bigint" || typeof value === "number" ? words.bare(value) : String(value);
        case "Float":    return formatFloat(value, words);
        case "String":   return value === "" ? '""' : String(value);
        case "DateTime": return value instanceof Date ? value.toISOString() : String(value);
        case "Blob":     return value instanceof Uint8Array ? `${value.length} bytes` : truncate(printFor(typeValue)(value));
        case "Variant":
            // Show just the tag — readable for status enums and friends.
            if (isVariant(value)) {
                const cases = typeValue.value as Array<{ name: string; type: EastTypeValue }>;
                const sub = cases.find(c => c.name === value.type);
                if (value.value === null || value.value === undefined || !sub) return value.type;
                return `${value.type}(${truncate(printFor(sub.type)(value.value))})`;
            }
            return "<value>";
        default:         return truncate(printFor(typeValue)(value));
    }
}

/** A float in the locale: a whole one keeps one decimal, a large one two, a smaller one four. */
function formatFloat(v: any, words: Formatters): string {
    if (typeof v !== "number") return String(v);
    if (Number.isInteger(v)) return words.value(v, FLOAT_WHOLE);
    return words.value(v, Math.abs(v) >= 1000 ? FLOAT_LARGE : FLOAT_SMALL);
}

function truncate(s: string): string {
    return s.length > MAX_INLINE_CHARS ? s.slice(0, MAX_INLINE_CHARS - 1) + "…" : s;
}

/**
 * Pretty-print a TreePath using the same "field: name" / "index: 5" /
 * "key: foo" pattern as the staged-store cache key — but reduced to a
 * bare label suitable for the binding-group header.
 */
export function formatBindingLabel(segments: ReadonlyArray<any>): string {
    if (segments.length === 0) return "(root)";
    const last = segments[segments.length - 1];
    if (last && typeof last === "object" && "type" in last) {
        if (last.type === "field") return String(last.value);
        if (last.type === "index") return `[${String(last.value)}]`;
        if (last.type === "key")   return String(last.value);
    }
    return String(last);
}
