/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure selection logic for the Schematic renderer — the managed slice
 * `in`-clause splice (the selection→slice bridge, #159) and the marquee
 * hit collection (#159). React-free and DOM-free so every rule the
 * interaction layer relies on is unit-testable in a `node` environment
 * (see `selection.test.ts`), mirroring the `camera.ts` / `paint.ts` split.
 *
 * @packageDocumentation
 */

import { variant, type ValueTypeOf } from "@elaraai/east";
import type RBush from "rbush";
import { Slice as SliceInternal, Schematic } from "@elaraai/east-ui/internal";

type SchematicItemValue = ValueTypeOf<typeof Schematic.Types.Item>;
/** Decoded slice value types are DERIVED from the East types (never hand-rolled). */
export type SlicePredicateValue = ValueTypeOf<typeof SliceInternal.Types.Predicate>;
export type SliceStateValue = ValueTypeOf<typeof SliceInternal.Types.State>;

/** An axis-aligned world-space box over an item, as stored in the culling R-tree. */
export interface ItemBox { minX: number; minY: number; maxX: number; maxY: number; item: SchematicItemValue }

/** Shared empty key set (stable identity — never churns memos / paint dedup). */
export const EMPTY_STRING_SET: ReadonlySet<string> = new Set();

/** True for the managed selection clause: a string `in` filter on `fieldId`. */
export function isSelectionClause(f: SlicePredicateValue, fieldId: string): boolean {
    return f.type === "string" && f.value.fieldId === fieldId && f.value.op.type === "in";
}

/** The key set currently held by the managed `in` clause on `fieldId` (empty if none). */
export function managedSelectionSet(filters: readonly SlicePredicateValue[], fieldId: string): ReadonlySet<string> {
    for (const f of filters) {
        if (isSelectionClause(f, fieldId)) return (f.value.op.value as ReadonlySet<string>);
    }
    return EMPTY_STRING_SET;
}

/** Set equality over string keys (order-free). */
export function sameStringSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) return false;
    for (const k of a) if (!b.has(k)) return false;
    return true;
}

/**
 * Splice the managed selection `in` clause into a slice state: replace it in
 * place (preserving order), append it if absent, or drop it when `sortedKeys`
 * is empty — leaving every other filter / range / cohort untouched. Keys
 * arrive pre-sorted so the built Set is canonical (the store's blobEqual
 * dedup is order-sensitive).
 *
 * @param state - the decoded slice state to splice into (not mutated)
 * @param fieldId - the field the managed `in` clause targets
 * @param sortedKeys - the selected keys, pre-sorted; empty ⇒ remove the clause
 * @returns a new state with only the managed clause changed
 */
export function sliceWithSelection(state: SliceStateValue, fieldId: string, sortedKeys: readonly string[]): SliceStateValue {
    const idx = state.filters.findIndex(f => isSelectionClause(f, fieldId));
    let filters: SlicePredicateValue[];
    if (sortedKeys.length === 0) {
        filters = idx < 0 ? [...state.filters] : state.filters.filter((_, j) => j !== idx);
    } else {
        const clause = variant("string", { fieldId, op: variant("in", new Set(sortedKeys)) }) as SlicePredicateValue;
        if (idx < 0) filters = [...state.filters, clause];
        else { filters = [...state.filters]; filters[idx] = clause; }
    }
    return { ...state, filters };
}

/**
 * Collect the items a marquee region selects: an R-tree sweep, then a
 * CENTER-in-region test (the index boxes are padded for culling, so bare
 * overlap would over-select), skipping locked items and slice-excluded
 * ghosts (context, not targets). Layer-hidden items never reach the tree.
 *
 * @param tree - the world-space culling R-tree over the working item set
 * @param region - the swept world rectangle
 * @param lockedKeys - keys in a locked layer (non-selectable)
 * @param excludedKeys - slice-excluded (ghosted) keys (non-selectable)
 * @returns the selected item keys
 */
export function marqueeHits(
    tree: RBush<ItemBox>,
    region: { minX: number; minY: number; maxX: number; maxY: number },
    lockedKeys: ReadonlySet<string>,
    excludedKeys: ReadonlySet<string>,
): Set<string> {
    const hits = new Set<string>();
    for (const b of tree.search(region)) {
        const k = b.item.key;
        if (lockedKeys.has(k)) continue;
        if (excludedKeys.has(k)) continue;
        if (b.item.x < region.minX || b.item.x > region.maxX || b.item.y < region.minY || b.item.y > region.maxY) continue;
        hits.add(k);
    }
    return hits;
}
