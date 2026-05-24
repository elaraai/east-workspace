/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure helpers for the conflict-resolution Manual editor — primitive leaf
 * types only. The renderer composes these with a Chakra Input; tests
 * exercise them directly without spinning up React.
 *
 * @packageDocumentation
 */

import type { EastTypeValue } from "@elaraai/east";

/**
 * Whether a leaf type supports inline manual editing in the conflict
 * chooser. Container leaves (Struct/Array/Dict/Set/Variant/Ref) and
 * "valueless" primitives (Null/Blob) return false — the renderer hides the
 * Manual chooser entirely for those.
 */
export function isPrimitiveLeafType(t: EastTypeValue | null): boolean {
    if (!t) return false;
    switch (t.type) {
        case "Boolean":
        case "Integer":
        case "Float":
        case "String":
        case "DateTime":
            return true;
        default:
            return false;
    }
}

/**
 * Render a leaf value as a string suitable for the manual-editor's text
 * input. Empty string when there's nothing useful to show.
 */
export function formatManualDraft(leafType: EastTypeValue | null, value: any): string {
    if (!leafType || value === undefined || value === null) return "";
    switch (leafType.type) {
        case "Boolean":  return value ? "true" : "false";
        case "Integer":  return typeof value === "bigint" ? value.toString() : String(value);
        case "Float":    return typeof value === "number" ? String(value) : String(value);
        case "String":   return String(value);
        case "DateTime": {
            if (!(value instanceof Date)) return String(value);
            // datetime-local wants `YYYY-MM-DDTHH:mm` — slice the ISO.
            return value.toISOString().slice(0, 16);
        }
        default: return "";
    }
}

/**
 * Parse a draft string back to a typed leaf value. Returns
 * `{ ok: false }` for invalid input — the renderer keeps the previous
 * valid value rather than firing onChange with garbage.
 */
export function parseManualDraft(
    leafType: EastTypeValue,
    draft: string,
): { ok: true; value: any } | { ok: false } {
    try {
        switch (leafType.type) {
            case "Integer":  return { ok: true, value: BigInt(draft) };
            case "Float":    {
                const n = Number(draft);
                if (Number.isNaN(n)) return { ok: false };
                return { ok: true, value: n };
            }
            case "String":   return { ok: true, value: draft };
            case "DateTime": {
                const d = new Date(draft);
                if (Number.isNaN(d.getTime())) return { ok: false };
                return { ok: true, value: d };
            }
            default: return { ok: false };
        }
    } catch {
        return { ok: false };
    }
}
