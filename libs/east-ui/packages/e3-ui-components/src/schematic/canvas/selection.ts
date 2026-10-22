/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure selection logic for the Schematic renderer — the marquee hit
 * collection (#159). React-free and DOM-free so every rule the interaction
 * layer relies on is unit-testable in a `node` environment (see
 * `selection.test.ts`), mirroring the `camera.ts` / `paint.ts` split.
 *
 * @packageDocumentation
 */

import type RBush from "rbush";
import { type DrawnItem } from "./drawn";

/** An axis-aligned world-space box over an item, as stored in the culling R-tree. */
export interface ItemBox { minX: number; minY: number; maxX: number; maxY: number; item: DrawnItem }

/** Shared empty key set (stable identity — never churns memos / paint dedup). */
export const EMPTY_STRING_SET: ReadonlySet<string> = new Set();

/**
 * Collect the items a marquee region selects: an R-tree sweep, then a
 * CENTER-in-region test (the index boxes are padded for culling, so bare
 * overlap would over-select), skipping locked items and narrowed-out items
 * drawn dimmed (context, not targets). Layer-hidden items never reach the tree.
 *
 * @param tree - the world-space culling R-tree over the working item set
 * @param region - the swept world rectangle
 * @param lockedKeys - keys in a locked layer (non-selectable)
 * @param excludedKeys - narrowed-out keys drawn dimmed (non-selectable)
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
