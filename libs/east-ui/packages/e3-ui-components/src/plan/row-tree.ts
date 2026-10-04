/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Walks over the row tree the flat, `parent`-keyed rows encode — shared by the
 * visible-row derivation and the body items (split out of `model.ts`, #815).
 *
 * @packageDocumentation
 */

import type { PlanRowIndex } from "./model.js";
import type { RowKey } from "./plan-state.js";

/** The strict ancestors of every key in `keys` — "which subtrees contain one"
 *  as a set, via upward `parent` walks (each ancestor visited once). */
export function ancestorsOf(index: PlanRowIndex, keys: ReadonlySet<RowKey> | undefined): ReadonlySet<RowKey> {
    const out = new Set<RowKey>();
    if (keys === undefined) return out;
    for (const key of keys) {
        let parent = index.byKey.get(key)?.parent;
        while (parent !== undefined && parent.type === "some" && !out.has(parent.value)) {
            out.add(parent.value);
            parent = index.byKey.get(parent.value)?.parent;
        }
    }
    return out;
}
