/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { SheetBodyItem } from "./model.js";

/** Visible membership, with rail ends clipped to adjacent resident members. */
export interface SheetMembership {
    id: string;
    color: number;
    above: boolean;
    below: boolean;
}

/** Assigns a stable palette slot independent of sort order and folding. */
export function groupColor(id: string): number {
    let hash = 2166136261;
    for (const char of id) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
    return (hash >>> 0) % 6 + 1;
}

function groupId(item: SheetBodyItem | undefined): string | undefined {
    if (item?.kind === "group") return item.row.id;
    return item?.kind === "real" ? item.group?.row.id : undefined;
}

/** Stops rails at padding, proposals, hidden or unloaded runs and group boundaries. */
export function membershipAt(body: readonly SheetBodyItem[], index: number): SheetMembership | undefined {
    const id = groupId(body[index]);
    if (id === undefined) return undefined;
    return { id, color: groupColor(id), above: groupId(body[index - 1]) === id, below: groupId(body[index + 1]) === id };
}
