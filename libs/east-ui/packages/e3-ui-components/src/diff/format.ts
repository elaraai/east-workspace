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

import { printFor, isVariant, type EastTypeValue } from "@elaraai/east";

const MAX_INLINE_CHARS = 48;

/**
 * Format a decoded East value into a short human-readable string. The
 * `typeValue` selects formatting:
 * - Primitives get a per-type compact form (e.g. `"42.50"`, `"2025-01-01"`).
 * - Variants render their tag (and a printed inner for non-null cases).
 * - Containers fall through to `printFor(typeValue)(value)`.
 *
 * When `typeValue` is null we have no type to round-trip against — return
 * `"<value>"`.
 */
export function formatLeafValue(typeValue: EastTypeValue | null, value: any): string {
    if (value === null || value === undefined) return "null";
    if (!typeValue) return "<value>";

    switch (typeValue.type) {
        case "Null":     return "null";
        case "Boolean":  return value ? "true" : "false";
        case "Integer":  return typeof value === "bigint" ? value.toString() : String(value);
        case "Float":    return formatFloat(value);
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

function formatFloat(v: any): string {
    if (typeof v !== "number") return String(v);
    if (Number.isInteger(v)) return v.toFixed(1);
    return Math.abs(v) >= 1000
        ? v.toLocaleString("en-US", { maximumFractionDigits: 2 })
        : String(Number(v.toFixed(4)));
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
