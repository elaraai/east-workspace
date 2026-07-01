/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { variant, equalFor } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { type PredicateValue } from "./predicate-format.js";

/** Structural predicate equality — drives the gesture's applied/pressed state
 *  and the toggle symmetry (the same comparator the platform impl uses). */
export const predicateEqual = equalFor(Slice.Types.Predicate) as (x: unknown, y: unknown) => boolean;

/**
 * Build the equality predicate a "filter to this" gesture toggles for a
 * breakdown group (#165): given the breakdown field's kind and a group key
 * (the stable `breakdownKeyOf` string — ISO for Dates), produce the typed
 * `Slice.Types.Predicate` that keeps exactly that group's rows.
 *
 * Kinds map to the operator each family can express equality with:
 * `string` → `eq`, `integer` → `eq` (parsed), `boolean` → `is`, `datetime` →
 * a closed `between` on the exact instant. Returns `undefined` when no
 * equality predicate exists for the kind (`float` is ordered-only) or the key
 * doesn't parse back — callers hide the gesture rather than emit a broken
 * clause. The top-N `other` roll-up bucket is not a field value; callers must
 * skip it (its key never parses for non-string kinds, but for string kinds
 * only the caller knows `other` is synthetic).
 *
 * @param kind - the breakdown field's primitive kind (from `slice.fields()`)
 * @param fieldId - the active breakdown field id
 * @param key - the group key to filter to
 * @returns the equality predicate, or `undefined` when inexpressible
 */
export function breakdownKeyPredicate(kind: string, fieldId: string, key: string): PredicateValue | undefined {
    switch (kind) {
        case "string":
            return variant("string", { fieldId, op: variant("eq", key) }) as PredicateValue;
        case "integer": {
            try { return variant("integer", { fieldId, op: variant("eq", BigInt(key)) }) as PredicateValue; }
            catch { return undefined; }
        }
        case "boolean":
            return key === "true" || key === "false"
                ? variant("boolean", { fieldId, op: variant("is", key === "true") }) as PredicateValue
                : undefined;
        case "datetime": {
            const d = new Date(key);
            if (Number.isNaN(d.getTime())) return undefined;
            // Closed interval on the exact instant — the datetime family's
            // equality (it has no `eq` op; `between` from==to matches exactly).
            return variant("datetime", { fieldId, op: variant("between", { from: d, to: d }) }) as PredicateValue;
        }
        default:
            return undefined;
    }
}
