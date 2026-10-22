/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The drawing with the drafts in place (#1388, `Schematic Builder Spec.md` §7,
 * SC23) — pure: what the canvas draws, its reader's stored rows with the
 * editing session's drafts over them, each drafted row drawn from the roles
 * its kind reads from it.
 *
 * - **A drafted row the read holds** draws as drafted: moved, its ends or its
 *   sides rewritten; one its draft deletes, or unplaces, draws nothing.
 * - **A new row** — one a gesture created — draws though no read holds it.
 * - **A drafted row the read does not hold** — a source's narrowing hides it —
 *   waits in its session: it draws once a read holds it again, as drafted,
 *   and Save sends it whatever is drawn.
 *
 * What a drafted row draws is kept by the roles it was drawn from, so a
 * render that moves no draft draws each the same.
 *
 * @packageDocumentation
 */

import {
    drawnItem, drawnLink, drawnNet, drawnZone, entityId,
    type DetailsRoles, type ItemRoles, type LinkRoles, type NetRoles, type SchematicDrawn, type SchematicRef, type ZoneRoles,
} from "./canvas/drawn.js";
import type { SchematicHeldRows } from "./data.js";

/** A drafted row, as the drawing takes it: its roles, as its kind reads them, and whether a gesture created it. */
export interface DraftedRow<R> {
    /** Its roles. */
    readonly roles: R;
    /** Whether a gesture created it: no read holds a row of its key. */
    readonly created: boolean;
}

/** One sort's drafts: by each kind's slot, then by key — the drafted row, or `undefined` for one its draft deletes. */
export type SortDrafts<R> = ReadonlyMap<string, ReadonlyMap<string, DraftedRow<R> | undefined>>;

/** Every kind's drafts, by sort. */
export interface SchematicDrafts {
    /** The item kinds'. */
    readonly items: SortDrafts<ItemRoles>;
    /** The zone kinds'. */
    readonly zones: SortDrafts<ZoneRoles>;
    /** The link kinds'. */
    readonly links: SortDrafts<LinkRoles>;
    /** The net kinds'. */
    readonly nets: SortDrafts<NetRoles>;
}

/** No drafts. */
export const NO_DRAFTS: SchematicDrafts = { items: new Map(), zones: new Map(), links: new Map(), nets: new Map() };

/** What a drafted row was drawn as, by the roles it was drawn from: kept while they are. */
export type DraftedCache = WeakMap<object, { readonly details: DetailsRoles | undefined; readonly drawn: unknown }>;

/**
 * Whether a sort has any draft.
 *
 * @param drafts - The sort's drafts
 * @returns Whether any kind of it has one
 */
function drafted(drafts: SortDrafts<unknown>): boolean {
    for (const rows of drafts.values()) if (rows.size > 0) return true;
    return false;
}

/**
 * One sort's entities with its drafts in place: each drafted entity the read
 * holds drawn from its drafted roles where it was — or nowhere, deleted or
 * unplaced — and each the read does not hold, a gesture created, after them.
 *
 * @param entities - The sort's stored entities, as the reader drew them
 * @param drafts - The sort's drafts
 * @param held - Each kind's rows the read holds
 * @param cache - What each drafted row was drawn as
 * @param draw - An entity from its reference, its roles and its details' roles; `undefined` for one that draws nothing
 * @returns The entities
 */
function merged<R extends object, E extends { readonly key: string }>(
    entities: readonly E[], drafts: SortDrafts<R>, held: SchematicHeldRows, cache: DraftedCache,
    draw: (ref: SchematicRef, roles: R, details: DetailsRoles | undefined) => E | undefined,
): E[] {
    // Each drafted entity, by its id: what it draws as, or `undefined` for nothing.
    const replaced = new Map<string, E | undefined>();
    for (const [slot, rows] of drafts) {
        const read = held.get(slot);
        for (const [key, row] of rows) {
            const ref = { kind: slot, key };
            const id = entityId(ref);
            if (row === undefined) { replaced.set(id, undefined); continue; }
            const kept = read?.get(key);
            // A row a narrowing hides waits in its session; a new one draws.
            if (kept === undefined && !row.created) continue;
            const details = kept?.details;
            const was = cache.get(row.roles);
            if (was !== undefined && was.details === details) { replaced.set(id, was.drawn as E | undefined); continue; }
            const drawn = draw(ref, row.roles, details);
            cache.set(row.roles, { details, drawn });
            replaced.set(id, drawn);
        }
    }
    const out: E[] = [];
    for (const entity of entities) {
        if (!replaced.has(entity.key)) { out.push(entity); continue; }
        const drawn = replaced.get(entity.key);
        replaced.delete(entity.key);
        if (drawn !== undefined) out.push(drawn);
    }
    // What the stored drawing holds none of: a new row, or a row placed by its draft.
    for (const drawn of replaced.values()) if (drawn !== undefined) out.push(drawn);
    return out;
}

/**
 * The drawing with the drafts in place (see the module docs).
 *
 * @param stored - What the reader drew of the stored rows
 * @param held - Each kind's rows the read holds, and their details' roles
 * @param drafts - Every kind's drafts
 * @param cache - What each drafted row was drawn as, kept across calls
 * @returns The drawing; the stored one itself while nothing is drafted
 */
export function draftedDrawing(stored: SchematicDrawn, held: SchematicHeldRows, drafts: SchematicDrafts, cache: DraftedCache): SchematicDrawn {
    const items = drafted(drafts.items), zones = drafted(drafts.zones), links = drafted(drafts.links), nets = drafted(drafts.nets);
    if (!items && !zones && !links && !nets) return stored;
    return {
        items: items ? merged(stored.items, drafts.items, held, cache, (ref, roles, details) => drawnItem(ref, roles, details)) : stored.items,
        zones: zones ? merged(stored.zones, drafts.zones, held, cache, (ref, roles) => drawnZone(ref, roles)) : stored.zones,
        links: links ? merged(stored.links, drafts.links, held, cache, (ref, roles) => drawnLink(ref, roles)) : stored.links,
        nets: nets ? merged(stored.nets, drafts.nets, held, cache, (ref, roles) => drawnNet(ref, roles)) : stored.nets,
    };
}
