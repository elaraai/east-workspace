/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records' matches as a list holds them (#1621): the blocks a key
 * search places among the rows a page holds of a source
 * (`recordSliceKeySearch`) — one with no scope, one for each of a scope's
 * values that holds a match — laid one after another, so the list's rows are
 * the matches alone, and each is read back at its place among the page's rows
 * (`recordSliceBasePage`). A builder whose Search Records seeks rows it holds
 * whole — the Roster's people — lists of a scoped source the rows its scope
 * holds alone, asked of e3 ({@link scopeHeld}).
 *
 * @packageDocumentation
 */

import { none, some, type ValueTypeOf, type option } from "@elaraai/east";
import { recordScopedWhere, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { awaitTracked, recordSliceRows, recordSliceWithin } from "@elaraai/east-ui-components/internal";

/**
 * Which of some rows of a source its page's scope holds (#1621), asked of e3:
 * their rows read by their keys in one request, and which of them the scope
 * holds in one more — a tracked read, which answers once both have. A key the
 * record holds no row by is held by none.
 *
 * @param part - The source's part of the slice, which holds a scope
 * @param keys - The rows' keys, Strings, each once
 * @returns The keys the scope holds; `none` while e3 has not said
 */
export function scopeHolds(part: ValueTypeOf<RecordSliceBindType>, keys: readonly string[]): option<ReadonlySet<string>> {
    if (keys.length === 0) return some(new Set());
    const rows = recordSliceRows(part, keys);
    if (rows.type === "none") return none;
    const stored = keys.flatMap((key, i) => {
        const row = rows.value[i]!;
        return row.type === "some" ? [{ key, row: row.value }] : [];
    });
    const held = stored.length === 0 ? some<boolean[]>([]) : recordSliceWithin(part, recordScopedWhere(part.config.scope, new Map()), stored);
    return held.type === "none" ? none : some(new Set(stored.flatMap(({ key }, i) => (held.value[i] ? [key] : []))));
}

/**
 * {@link scopeHolds}, awaited: which of some rows of a source its page's scope
 * holds, once e3 has said.
 *
 * @param part - The source's part of the slice; `undefined` with none
 * @param keys - The rows' keys, Strings, each once
 * @returns The keys the scope holds; `undefined` with no part, or a page with no scope, which holds every row
 */
export async function scopeHeld(part: ValueTypeOf<RecordSliceBindType> | undefined, keys: readonly string[]): Promise<ReadonlySet<string> | undefined> {
    if (part === undefined || part.config.scope.size === 0) return undefined;
    return awaitTracked(() => scopeHolds(part, keys));
}

/** A block of matches among the rows a page holds of a source: where it starts there, and how many it holds. */
export interface FoundBlock {
    /** Its first row, among the page's rows. */
    readonly row: bigint;
    /** How many rows it holds. */
    readonly count: bigint;
}

/** A stretch of a list's rows, read from one block: its first row among the page's rows, how many, and its first's row in the list. */
export interface FoundStretch {
    /** Its first row, among the page's rows. */
    readonly from: bigint;
    /** How many rows. */
    readonly n: number;
    /** Its first row's place in the list. */
    readonly at: number;
}

/**
 * The stretches a list's rows `[row, row + limit)` are read in, its matches
 * one block after another.
 *
 * @param blocks - The blocks, in the page's rows' order
 * @param row - The list's first row
 * @param limit - How many rows it reads
 * @returns Each stretch, in the list's order
 */
export function blocksAt(blocks: readonly FoundBlock[], row: number, limit: number): FoundStretch[] {
    const out: FoundStretch[] = [];
    let base = 0;
    for (const block of blocks) {
        const count = Number(block.count);
        const from = Math.max(row, base), to = Math.min(row + limit, base + count);
        if (from < to) out.push({ from: block.row + BigInt(from - base), n: to - from, at: from });
        base += count;
    }
    return out;
}
