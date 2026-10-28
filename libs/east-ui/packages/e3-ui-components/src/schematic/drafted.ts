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
 *   and Save sends it whatever is drawn. A kind read by area reads only its
 *   window (#1393): a drafted row of it its window doesn't hold — moved off
 *   the window, or placed from the Backlog — draws where its draft places it,
 *   while its narrowing holds it, as the row its session began from answers
 *   (`drafts-narrowing.ts`): one the hidden narrowing leaves out waits in its
 *   session, as every kind's does, and one the dimmed narrowing leaves out
 *   draws as context (`narrowing.ts`).
 *
 * What a drafted row draws is kept by the roles it was drawn from, so a
 * render that moves no draft draws each the same.
 *
 * What the drawing leaves out of the drafts — each drafted row waiting in its
 * session — is made as its kind draws it too (`waitingDrafts`), never for the
 * canvas: Issues checks it beside the drawing, so every unsaved change is
 * checked, drawn or not (ruled 27 Oct 2026, "Checked in view, said so"), and
 * Go to issue flies to where it stands (`waitingPoint`).
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import {
    EMPTY_DRAWN, drawnItem, drawnLink, drawnNet, drawnZone, entityId,
    type CardRoles, type DetailsRoles, type ItemRoles, type LinkRoles, type NetRoles, type SchematicDrawn, type SchematicRef, type ZoneRoles,
} from "./canvas/drawn.js";
import { zoneAnchor } from "./canvas/paint.js";
import type { SchematicHeldRows } from "./data.js";

const stringEqual = equalFor(StringType);

/** A drafted row, as the drawing takes it: its roles, as its kind reads them, and whether a gesture created it. */
export interface DraftedRow<R> {
    /** Its roles. */
    readonly roles: R;
    /** Whether a gesture created it: no read holds a row of its key. */
    readonly created: boolean;
    /**
     * The roles of the row its session began from — what its record held when the session first read it — as its kind
     * reads them: where a kind read by area's paged Backlog lists it, by its stored place (`backlog.ts`, #1393).
     * `undefined` for a row a gesture created, and where the session is not said.
     */
    readonly began?: R | undefined;
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

/** What a drafted row was drawn as, by the roles it was drawn from: kept while they are, and its details' and what of them is unread. */
export type DraftedCache = WeakMap<object, { readonly details: DetailsRoles | undefined; readonly pending: CardRoles | undefined; readonly drawn: unknown }>;

/** No kind read by area. */
const NONE_WINDOWED: ReadonlySet<string> = new Set();

/** Nothing the narrowing leaves out. */
const NONE_LEFT_OUT = (): boolean => false;

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
 * Whether a drafted row waits in its session, drawn nowhere (see the module docs): no read holds it, no gesture created
 * it, and its kind is read otherwise than by area — a source's narrowing leaves it out — or by area, its window not
 * holding it, while the hidden narrowing leaves out the row its session began from.
 *
 * @param kept - What the read holds of it; `undefined` for nothing
 * @param row - The drafted row
 * @param windowed - Whether its kind is read by area
 * @param leftOut - Whether the hidden narrowing leaves it out, asked only of a kind read by area's row its read doesn't hold
 * @returns Whether it waits in its session
 */
function waits(kept: unknown, row: DraftedRow<unknown>, windowed: boolean, leftOut: () => boolean): boolean {
    return kept === undefined && !row.created && (!windowed || leftOut());
}

/**
 * One sort's entities with its drafts in place: each drafted entity the read
 * holds drawn from its drafted roles where it was — or nowhere, deleted or
 * unplaced — and each the read does not hold, a gesture created, after them.
 *
 * @param entities - The sort's stored entities, as the reader drew them
 * @param drafts - The sort's drafts
 * @param held - Each kind's rows the read holds
 * @param windowed - The kinds read by area, by slot: a drafted row of one draws though its window doesn't hold it
 * @param leftOut - Whether the hidden narrowing leaves out a drafted row of a kind read by area its window doesn't hold
 * @param cache - What each drafted row was drawn as
 * @param draw - An entity from its reference, its roles, its details' roles and the card roles they give while they are
 *   read (#1398); `undefined` for one that draws nothing
 * @returns The entities
 */
function merged<R extends object, E extends { readonly key: string }>(
    entities: readonly E[], drafts: SortDrafts<R>, held: SchematicHeldRows, windowed: ReadonlySet<string>, leftOut: (ref: SchematicRef) => boolean,
    cache: DraftedCache, draw: (ref: SchematicRef, roles: R, details: DetailsRoles | undefined, pending: CardRoles | undefined) => E | undefined,
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
            // A row a narrowing hides waits in its session; a new one draws, and one of a kind read by area its window doesn't
            // hold while its narrowing holds it.
            if (waits(kept, row, windowed.has(slot), () => leftOut(ref))) continue;
            // A drafted card over a row whose details are read holds their places, as the row's own does (#1398).
            const details = kept?.details;
            const pending = kept?.pending;
            const was = cache.get(row.roles);
            // The very details it was drawn with, as the reader keeps them while they read again as they were.
            if (was !== undefined && Object.is(was.details, details) && Object.is(was.pending, pending)) { replaced.set(id, was.drawn as E | undefined); continue; }
            const drawn = draw(ref, row.roles, details, pending);
            cache.set(row.roles, { details, pending, drawn });
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
 * @param windowed - The kinds read by area, by slot (#1393): a drafted row of one its window doesn't hold draws
 * @param leftOut - Whether the hidden narrowing leaves out a drafted row of a kind read by area its window doesn't hold, as
 *   the row its session began from answers (`drafts-narrowing.ts`): it waits in its session; none while nothing does
 * @returns The drawing; the stored one itself while nothing is drafted
 */
export function draftedDrawing(stored: SchematicDrawn, held: SchematicHeldRows, drafts: SchematicDrafts, cache: DraftedCache,
    windowed: ReadonlySet<string> = NONE_WINDOWED, leftOut: (ref: SchematicRef) => boolean = NONE_LEFT_OUT): SchematicDrawn {
    const items = drafted(drafts.items), zones = drafted(drafts.zones), links = drafted(drafts.links), nets = drafted(drafts.nets);
    if (!items && !zones && !links && !nets) return stored;
    return {
        items: items ? merged(stored.items, drafts.items, held, windowed, leftOut, cache, (ref, roles, details, pending) => drawnItem(ref, roles, details, pending)) : stored.items,
        zones: zones ? merged(stored.zones, drafts.zones, held, windowed, leftOut, cache, (ref, roles) => drawnZone(ref, roles)) : stored.zones,
        links: links ? merged(stored.links, drafts.links, held, windowed, leftOut, cache, (ref, roles) => drawnLink(ref, roles)) : stored.links,
        nets: nets ? merged(stored.nets, drafts.nets, held, windowed, leftOut, cache, (ref, roles) => drawnNet(ref, roles)) : stored.nets,
    };
}

/**
 * The drafted rows the drawing leaves out, each waiting in its session — a
 * narrowing leaves out the row it drafts (see the module docs) — made as
 * their kinds draw them: what Issues checks beside the drawing, so an unsaved
 * change carries no issue unseen, wherever it is drawn or not (ruled 27 Oct
 * 2026, "Checked in view, said so"). Never the canvas's: what the narrowing
 * hides is drawn nowhere. An item with no position draws nothing here, as on
 * the canvas; a row its draft deletes is no row.
 *
 * @param held - Each kind's rows the read holds
 * @param drafts - Every kind's drafts
 * @param windowed - The kinds read by area, by slot, as {@link draftedDrawing} takes them
 * @param leftOut - Whether the hidden narrowing leaves out a drafted row of a kind read by area its window doesn't hold, as
 *   {@link draftedDrawing} takes it
 * @returns The rows, each kind's in its drafts' order — no row while every draft draws
 */
export function waitingDrafts(held: SchematicHeldRows, drafts: SchematicDrafts, windowed: ReadonlySet<string> = NONE_WINDOWED,
    leftOut: (ref: SchematicRef) => boolean = NONE_LEFT_OUT): SchematicDrawn {
    const sort = <R, E>(sorted: SortDrafts<R>, draw: (ref: SchematicRef, roles: R) => E | undefined): E[] => {
        const out: E[] = [];
        for (const [slot, rows] of sorted) {
            const read = held.get(slot);
            for (const [key, row] of rows) {
                const ref = { kind: slot, key };
                if (row === undefined || !waits(read?.get(key), row, windowed.has(slot), () => leftOut(ref))) continue;
                const drawn = draw(ref, row.roles);
                if (drawn !== undefined) out.push(drawn);
            }
        }
        return out;
    };
    const items = sort(drafts.items, (ref, roles) => drawnItem(ref, roles, undefined));
    const zones = sort(drafts.zones, drawnZone);
    const links = sort(drafts.links, drawnLink);
    const nets = sort(drafts.nets, drawnNet);
    return items.length + zones.length + links.length + nets.length === 0 ? EMPTY_DRAWN : { items, zones, links, nets };
}

/**
 * The drawing with the drafted rows it leaves out beside it ({@link waitingDrafts}): what Issues checks and names.
 *
 * @param drawn - The drawing, the drafts drawn in place
 * @param waiting - The drafted rows it leaves out
 * @returns Both, each sort's drawn entities first; the drawing itself while none waits
 */
export function withWaiting(drawn: SchematicDrawn, waiting: SchematicDrawn): SchematicDrawn {
    if (waiting.items.length + waiting.zones.length + waiting.links.length + waiting.nets.length === 0) return drawn;
    return {
        items: [...drawn.items, ...waiting.items],
        zones: [...drawn.zones, ...waiting.zones],
        links: [...drawn.links, ...waiting.links],
        nets: [...drawn.nets, ...waiting.nets],
    };
}

/**
 * Where a drafted row waiting in its session stands, as its draft places it: what the camera looks at as Go to issue
 * goes to it (#1391) — an item's centre; a zone's box's centre, its anchor; a link's or a net's members' box's centre,
 * each member where the drawing or a waiting row places it.
 *
 * @param id - The row's id
 * @param waiting - The drafted rows waiting in their sessions ({@link waitingDrafts})
 * @param drawn - The drawing, the drafts drawn in place
 * @returns Its point; `undefined` for an id no waiting row has, and for a link or a net none of whose members is placed
 */
export function waitingPoint(id: string, waiting: SchematicDrawn, drawn: SchematicDrawn): { readonly x: number; readonly y: number } | undefined {
    const item = waiting.items.find((it) => stringEqual(it.key, id));
    if (item !== undefined) return { x: item.x, y: item.y };
    const zone = waiting.zones.find((z) => stringEqual(z.key, id));
    if (zone !== undefined) return zoneAnchor(zone);
    const link = waiting.links.find((l) => stringEqual(l.key, id));
    const net = link === undefined ? waiting.nets.find((n) => stringEqual(n.key, id)) : undefined;
    const members = link !== undefined ? [link.from, link.to] : net !== undefined ? [...net.sources, ...net.destinations] : [];
    const placed = members.flatMap((member) => {
        const at = drawn.items.find((it) => stringEqual(it.key, member)) ?? waiting.items.find((it) => stringEqual(it.key, member));
        return at === undefined ? [] : [at];
    });
    if (placed.length === 0) return undefined;
    const xs = placed.map((at) => at.x), ys = placed.map((at) => at.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

