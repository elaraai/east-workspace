/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Local placements, in order (#859). A draft's ordered place — before or
 * after another row, or at the start or the end — applies one after another,
 * as a batch applies them. The rows are a list linked through their ids, so a
 * move is a constant-time unlink and link: never a search and two splices over
 * the whole collection per move, which made a paste of thousands of placed
 * rows quadratic.
 *
 * @packageDocumentation
 */

import type { Placement } from "./transactions.js";

/**
 * The rows in the order their placements put them, each applied in turn:
 * O(rows + moves).
 *
 * @remarks
 * A placement whose row or anchor is not among the rows moves nothing, and
 * neither does one anchored on its own row (a batch refuses it). A keyed
 * placement leaves the order to the key sort. Where two rows share an id,
 * the first is the one that moves and the one anchored on.
 *
 * @typeParam T - The row
 * @param rows - The rows in their current order
 * @param idOf - A row's id
 * @param moves - Each placed row's id and its placement, in the order they apply
 * @returns The rows in their new order — `rows` itself when nothing moved
 */
export function placeInOrder<T>(rows: T[], idOf: (row: T) => string, moves: Iterable<readonly [string, Placement]>): T[] {
    const n = rows.length;
    const at = new Map<string, number>();
    for (let i = 0; i < n; i++) {
        const id = idOf(rows[i]!);
        if (!at.has(id)) at.set(id, i);
    }
    const prev = new Int32Array(n);
    const next = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        prev[i] = i - 1;
        next[i] = i + 1 < n ? i + 1 : -1;
    }
    let head = n > 0 ? 0 : -1;
    let tail = n - 1;
    const unlink = (i: number) => {
        const p = prev[i]!;
        const q = next[i]!;
        if (p >= 0) next[p] = q; else head = q;
        if (q >= 0) prev[q] = p; else tail = p;
    };
    const linkBefore = (i: number, j: number) => {
        const p = prev[j]!;
        prev[i] = p;
        next[i] = j;
        prev[j] = i;
        if (p >= 0) next[p] = i; else head = i;
    };
    const linkAfter = (i: number, j: number) => {
        const q = next[j]!;
        next[i] = q;
        prev[i] = j;
        next[j] = i;
        if (q >= 0) prev[q] = i; else tail = i;
    };
    let moved = false;
    for (const [id, placement] of moves) {
        if (placement.type !== "some" || placement.value.type !== "ordered") continue;
        const i = at.get(id);
        if (i === undefined) continue;
        const position = placement.value.value;
        let j = -1;
        if (position.type === "before" || position.type === "after") {
            const anchor = at.get(position.value);
            if (anchor === undefined || anchor === i) continue;
            j = anchor;
        }
        unlink(i);
        if (head < 0) {
            // The row was the only one: it is the list again.
            head = tail = i;
            prev[i] = -1;
            next[i] = -1;
        } else if (position.type === "start") linkBefore(i, head);
        else if (position.type === "end") linkAfter(i, tail);
        else if (position.type === "before") linkBefore(i, j);
        else linkAfter(i, j);
        moved = true;
    }
    if (!moved) return rows;
    const out: T[] = [];
    for (let i = head; i >= 0; i = next[i]!) out.push(rows[i]!);
    return out;
}
