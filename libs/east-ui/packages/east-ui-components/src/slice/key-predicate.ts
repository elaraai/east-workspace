/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { DateTimeType, IntegerType, SortedSet, StringType, compareFor, equalFor, variant } from "@elaraai/east";
import { readSliceGroupKey, sliceGroupKey } from "@elaraai/east-ui/internal";
import { type PredicateValue } from "./predicate-format.js";

export { type PredicateValue } from "./predicate-format.js";

const compareIntegers = compareFor(IntegerType);
const compareStrings = compareFor(StringType);
const equalInstants = equalFor(DateTimeType);

/**
 * Build the equality predicate a "filter to this" gesture toggles for a
 * breakdown group (#165): given the breakdown field's kind and a group key
 * (its `sliceGroupKey`, read back through East by `readSliceGroupKey`),
 * produce the typed `Slice.Types.Predicate` that keeps exactly that group's
 * rows.
 *
 * Kinds map to the operator each family can express equality with:
 * `string` → `eq`, `integer` → `eq`, `boolean` → `is`, `datetime` → a closed
 * `between` on the exact instant. Returns `undefined` when no equality
 * predicate exists for the kind (`float` is ordered-only) or the key does not
 * read as the kind's value — callers hide the gesture rather than emit a
 * broken clause. The top-N `other` roll-up bucket is not a field value;
 * callers must skip it (its key never reads for non-string kinds, but for
 * string kinds only the caller knows `other` is synthetic).
 *
 * @param kind - the breakdown field's primitive kind (from `slice.fields()`)
 * @param fieldId - the active breakdown field id
 * @param key - the group key to filter to
 * @returns the equality predicate, or `undefined` when inexpressible
 */
export function breakdownKeyPredicate(kind: string, fieldId: string, key: string): PredicateValue | undefined {
    switch (kind) {
        case "string":
            return variant("string", { fieldId, op: variant("eq", key) });
        case "integer": {
            const value = readSliceGroupKey("integer", key);
            return value === undefined ? undefined : variant("integer", { fieldId, op: variant("eq", value) });
        }
        case "boolean": {
            const value = readSliceGroupKey("boolean", key);
            return value === undefined ? undefined : variant("boolean", { fieldId, op: variant("is", value) });
        }
        case "datetime": {
            // Closed interval on the exact instant — the datetime family's
            // equality (it has no `eq` op; `between` from==to matches exactly).
            const instant = readSliceGroupKey("datetime", key);
            return instant === undefined ? undefined : variant("datetime", { fieldId, op: variant("between", { from: instant, to: instant }) });
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

/** True when this filter is the facet-MANAGED one for (kind, fieldId):
 *  string/integer `in` or `eq`, boolean `is`, datetime `between`. */
function isManagedFilter(filter: PredicateValue, kind: string, fieldId: string): boolean {
    if (filter.type !== kind || filter.value.fieldId !== fieldId) return false;
    switch (filter.type) {
        case "string":
        case "integer":
            return filter.value.op.type === "in" || filter.value.op.type === "eq";
        case "boolean":
            return filter.value.op.type === "is";
        case "datetime":
            return filter.value.op.type === "between";
        default:
            return false;
    }
}

/** The group keys a facet-managed filter selects, each spelled as the groups
 *  spell their keys. A `between` selects a group only when it pins one
 *  instant. */
function selectedKeysOf(managed: PredicateValue): Set<string> {
    const op = managed.value.op;
    switch (op.type) {
        case "in":
            return new Set([...op.value].map(member => sliceGroupKey(member)));
        case "eq":
        case "is":
            return new Set([sliceGroupKey(op.value)]);
        case "between":
            return equalInstants(op.value.from, op.value.to) ? new Set([sliceGroupKey(op.value.from)]) : new Set();
        default:
            return new Set();
    }
}

/**
 * The group keys currently selected by the field's facet-managed filter —
 * spelled with `sliceGroupKey`, as the groups spell theirs, so callers can
 * test `selected.has(group.key)` directly. Empty when no managed filter.
 *
 * @param filters - the decoded `state.filters`
 * @param kind - the breakdown field's primitive kind
 * @param fieldId - the breakdown field id
 * @returns the selected group keys
 */
export function selectedFieldKeys(filters: ReadonlyArray<PredicateValue>, kind: string, fieldId: string): Set<string> {
    const managed = filters.find(f => isManagedFilter(f, kind, fieldId));
    return managed === undefined ? new Set() : selectedKeysOf(managed);
}

/** A string field's managed `in` filter over the selected keys: an East Set,
 *  in East's order. */
function stringIn(fieldId: string, keys: ReadonlySet<string>): PredicateValue {
    return variant("string", { fieldId, op: variant("in", new SortedSet(keys, compareStrings)) });
}

/** An integer field's managed `in` filter over the selected keys, each read
 *  back through East: an East Set, in East's order. */
function integerIn(fieldId: string, keys: ReadonlySet<string>): PredicateValue {
    const members = new SortedSet<bigint>(undefined, compareIntegers);
    for (const key of keys) {
        const member = readSliceGroupKey("integer", key);
        if (member !== undefined) members.add(member);
    }
    return variant("integer", { fieldId, op: variant("in", members) });
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
    const pinned = breakdownKeyPredicate(kind, fieldId, key);
    if (pinned === undefined) return undefined;
    const rest = filters.filter(f => !isManagedFilter(f, kind, fieldId));
    const selected = selectedFieldKeys(filters, kind, fieldId);
    // The clicked group, spelled as the selection spells it.
    const clicked = selectedKeysOf(pinned);
    const on = [...clicked].every(k => selected.has(k));

    if (kind === "string" || kind === "integer") {
        for (const k of clicked) {
            if (on) selected.delete(k); else selected.add(k);
        }
        if (selected.size === 0) return rest;
        return [...rest, kind === "integer" ? integerIn(fieldId, selected) : stringIn(fieldId, selected)];
    }
    // boolean / datetime: replace-single — clicking the selected key clears it.
    return on ? rest : [...rest, pinned];
}
