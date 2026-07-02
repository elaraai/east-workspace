/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { variant, equalFor } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { type PredicateValue } from "./predicate-format.js";

export { type PredicateValue } from "./predicate-format.js";

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

// ---------------------------------------------------------------------------
// Facet selection semantics (#188) — the legend / breakdown chips maintain
// ONE managed filter per breakdown field: string/integer use the `in` op
// (multi-select — OR within the field, AND across fields), boolean/datetime
// replace-single (`is` / a closed `between`). A click toggles a group key's
// membership; emptying the selection drops the filter. Everything here is
// pure over decoded values, applied atomically via one `slice.write`.
// ---------------------------------------------------------------------------

/** Parse a stable group key (breakdownKeyOf output) back to the field's typed
 *  value. `undefined` = not expressible (float kinds, unparseable keys). */
function parseGroupKey(kind: string, key: string): string | bigint | boolean | Date | undefined {
    switch (kind) {
        case "string": return key;
        case "integer": { try { return BigInt(key); } catch { return undefined; } }
        case "boolean": return key === "true" ? true : key === "false" ? false : undefined;
        case "datetime": { const d = new Date(key); return Number.isNaN(d.getTime()) ? undefined : d; }
        default: return undefined;
    }
}

/** A predicate's body, loosely typed at the decoded boundary. */
type PredBody = { fieldId: string; op: { type: string; value: unknown } };

/** True when this filter is the facet-MANAGED one for (kind, fieldId):
 *  string/integer `in` or `eq`, boolean `is`, datetime `between`. */
function isManagedFilter(f: PredicateValue, kind: string, fieldId: string): boolean {
    if (f.type !== kind) return false;
    const body = f.value as PredBody;
    if (body.fieldId !== fieldId) return false;
    if (kind === "string" || kind === "integer") return body.op.type === "in" || body.op.type === "eq";
    if (kind === "boolean") return body.op.type === "is";
    if (kind === "datetime") return body.op.type === "between";
    return false;
}

/**
 * The group keys currently selected by the field's facet-managed filter —
 * stringified with the same stable encoding as group keys, so callers can
 * test `selected.has(group.key)` directly. Empty when no managed filter.
 *
 * @param filters - the decoded `state.filters`
 * @param kind - the breakdown field's primitive kind
 * @param fieldId - the breakdown field id
 * @returns the selected group keys
 */
export function selectedFieldKeys(filters: ReadonlyArray<PredicateValue>, kind: string, fieldId: string): Set<string> {
    const managed = filters.find(f => isManagedFilter(f, kind, fieldId));
    if (managed === undefined) return new Set();
    const op = (managed.value as PredBody).op;
    if (op.type === "in") return new Set([...(op.value as Set<unknown>)].map(v => String(v)));
    if (op.type === "eq" || op.type === "is") return new Set([String(op.value)]);
    // datetime between — selected only when it pins one exact instant.
    const { from, to } = op.value as { from: Date; to: Date };
    return from.getTime() === to.getTime() ? new Set([from.toISOString()]) : new Set();
}

/**
 * The next `state.filters` after toggling `key` in the field's facet
 * selection (#188): string/integer maintain ONE `in`-set filter (an existing
 * `eq` merges in as a singleton; removing the last member drops the filter),
 * boolean/datetime replace-single. Filters on other fields — and other-op
 * filters on the same field (`contains`, ranges…) — pass through untouched.
 *
 * @param filters - the decoded `state.filters`
 * @param kind - the breakdown field's primitive kind
 * @param fieldId - the breakdown field id
 * @param key - the clicked group's stable key
 * @returns the new filters array, or `undefined` when the key is not
 *          expressible for the kind (callers render such items inert)
 */
export function nextFieldFilters(
    filters: ReadonlyArray<PredicateValue>,
    kind: string,
    fieldId: string,
    key: string,
): PredicateValue[] | undefined {
    const v = parseGroupKey(kind, key);
    if (v === undefined) return undefined;
    const rest = filters.filter(f => !isManagedFilter(f, kind, fieldId));
    const selected = selectedFieldKeys(filters, kind, fieldId);

    if (kind === "string" || kind === "integer") {
        if (selected.has(key)) selected.delete(key); else selected.add(key);
        if (selected.size === 0) return rest;
        const members = kind === "integer"
            ? new Set([...selected].map(k => BigInt(k)))
            : new Set([...selected]);
        return [...rest, variant(kind, { fieldId, op: variant("in", members) }) as unknown as PredicateValue];
    }
    // boolean / datetime: replace-single — clicking the selected key clears it.
    if (selected.has(kind === "datetime" ? (v as Date).toISOString() : key)) return rest;
    return [...rest, breakdownKeyPredicate(kind, fieldId, key)!];
}
