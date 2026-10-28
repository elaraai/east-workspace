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
 * area (#1393) pages them through its area index instead (`backlog-pages.ts`),
 * and holds only its window: its drafted rows with no position are listed
 * here wherever the window is, each told by the row its session began from, as
 * the Calendar's paged Backlog tells its drafted events — one whose stored row
 * had a position, which no page lists, while its narrowing holds that row
 * (`drafts-narrowing.ts`); one whose stored row had none is its page's, its
 * draft in place.
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

/** The item kinds read by area (#1393), as the Backlog lists their drafted rows: by the row each one's session began from. */
export interface BacklogArea {
    /** The kinds read by area, by slot. */
    readonly kinds: ReadonlySet<string>;
    /**
     * Whether a kind read by area's narrowing holds a drafted row, by the row its session began from: `false` leaves it
     * out; `undefined` for one not asked — nothing narrows the kind, or the answer is in flight — which is listed.
     */
    readonly held: (ref: SchematicRef) => boolean | undefined;
}

/** No row. */
const NO_ROWS: ReadonlyMap<string, never> = new Map<string, never>();

/** No kind read by area. */
const NO_AREA: BacklogArea = { kinds: new Set(), held: () => undefined };

/**
 * The rows the Backlog lists (see the module docs).
 *
 * @param kinds - The item kinds, in the Schematic's order
 * @param unplaced - Each item kind's rows the read holds with no position
 * @param held - Each kind's rows the read holds
 * @param drafts - The item kinds' drafts
 * @param area - The kinds read by area, and whether their narrowing holds a drafted row; none by default
 * @returns The rows, each kind's in its read's order, then its drafted ones in theirs
 */
export function backlogEntries(kinds: readonly BacklogKind[], unplaced: SchematicUnplacedRows, held: SchematicHeldRows,
    drafts: SortDrafts<ItemRoles>, area: BacklogArea = NO_AREA): BacklogEntry[] {
    const out: BacklogEntry[] = [];
    for (const kind of kinds) {
        if (!kind.backlog) continue;
        const drafted = drafts.get(kind.key) ?? NO_ROWS;
        const read = held.get(kind.key);
        const byArea = area.kinds.has(kind.key);
        for (const [key, roles] of unplaced.get(kind.key) ?? NO_ROWS) {
            if (drafted.has(key)) continue;
            const ref = { kind: kind.key, key };
            out.push({ ref, id: entityId(ref), roles });
        }
        for (const [key, row] of drafted) {
            if (row === undefined || row.roles.position.type === "some") continue;
            const ref = { kind: kind.key, key };
            if (!row.created) {
                if (byArea) {
                    // A kind read by area, wherever its window is: a row whose stored row had no position is its page's, and
                    // one the narrowing leaves out — by the row its session began from — waits in its session.
                    if (row.began?.position.type !== "some" || area.held(ref) === false) continue;
                } else if (read?.has(key) !== true) {
                    // A row a narrowing hides waits in its session; a new one is listed.
                    continue;
                }
            }
            out.push({ ref, id: entityId(ref), roles: row.roles });
        }
    }
    return out;
}
