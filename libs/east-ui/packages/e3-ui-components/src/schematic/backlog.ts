/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The library's Backlog (#1389, `Schematic Builder Spec.md` §8, SC4) — pure:
 * every item kind's rows with no position, each kind's in the Schematic's
 * order of its kinds, the read's rows with the editing session's drafts in
 * place, as the canvas draws its rows (`drafted.ts`):
 *
 * - **a stored row with no position** is listed, unless a draft holds it —
 *   the draft decides;
 * - **a drafted row with no position** is listed: one a gesture unplaced, or
 *   one it created unplaced;
 * - **a drafted row placed, or deleted**, is not;
 * - **a drafted row the read does not hold** — a source's narrowing hides it —
 *   waits in its session, listed once a read holds it again; a new one is
 *   listed always.
 *
 * A kind read whole, or complete through its source, holds its every row with
 * no position its read holds: those are what the Backlog lists. A kind read by
 * area (#1393) pages them through its area index instead.
 *
 * @packageDocumentation
 */

import { entityId, type ItemRoles, type SchematicRef } from "./canvas/drawn.js";
import type { SchematicHeldRows, SchematicUnplacedRows } from "./data.js";
import type { SortDrafts } from "./drafted.js";

/** One row the Backlog lists: its kind's slot and its key, its id on the canvas, and its roles. */
export interface BacklogEntry {
    /** Its kind's slot and its key. */
    readonly ref: SchematicRef;
    /** Its reference, printed: its id on the canvas, and its card's key. */
    readonly id: string;
    /** Its roles, as its kind reads them: its card's label, icon, second line and status. */
    readonly roles: ItemRoles;
}

/** An item kind, as the Backlog reads it: its slot, and whether its rows may have no position. */
export interface BacklogKind {
    /** Its slot. */
    readonly key: string;
    /** Whether its `x` and `y` are Options: its rows with no position are its backlog. */
    readonly backlog: boolean;
}

/** No row. */
const NO_ROWS: ReadonlyMap<string, never> = new Map<string, never>();

/**
 * The rows the Backlog lists (see the module docs).
 *
 * @param kinds - The item kinds, in the Schematic's order
 * @param unplaced - Each item kind's rows the read holds with no position
 * @param held - Each kind's rows the read holds
 * @param drafts - The item kinds' drafts
 * @returns The rows, each kind's in its read's order, then its drafted ones in theirs
 */
export function backlogEntries(kinds: readonly BacklogKind[], unplaced: SchematicUnplacedRows, held: SchematicHeldRows,
    drafts: SortDrafts<ItemRoles>): BacklogEntry[] {
    const out: BacklogEntry[] = [];
    for (const kind of kinds) {
        if (!kind.backlog) continue;
        const drafted = drafts.get(kind.key) ?? NO_ROWS;
        const read = held.get(kind.key);
        for (const [key, roles] of unplaced.get(kind.key) ?? NO_ROWS) {
            if (drafted.has(key)) continue;
            const ref = { kind: kind.key, key };
            out.push({ ref, id: entityId(ref), roles });
        }
        for (const [key, row] of drafted) {
            if (row === undefined || row.roles.position.type === "some") continue;
            // A row a narrowing hides waits in its session; a new one is listed.
            if (!row.created && read?.has(key) !== true) continue;
            const ref = { kind: kind.key, key };
            out.push({ ref, id: entityId(ref), roles: row.roles });
        }
    }
    return out;
}
