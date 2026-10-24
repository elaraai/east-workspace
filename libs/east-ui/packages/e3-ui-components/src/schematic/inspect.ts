/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Schematic's inspector shows (#1391, `Schematic Builder Spec.md`
 * §9, SC15) — pure and React-free: the selection as Details shows it, and what
 * an item is joined to.
 *
 * - **Nothing selected** — the drawing.
 * - **One entity** — an item, a zone, a link or a net; or a net's leg, the
 *   stub a tap selected, its item on one side.
 * - **Several** — each by its sort and its reference, in the order the canvas
 *   selected them.
 * - **An item with no position** — below 480px of main, the Backlog's card
 *   picked (#1394, D15), which Details places at the canvas's centre. The frame
 *   says which; the canvas draws none.
 *
 * An id the drawing no longer draws is left out: a selection the canvas holds
 * a moment longer than the drawing does shows what is left of it.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import type { DrawnLink, DrawnNet, SchematicDrawn, SchematicRef } from "./canvas/drawn.js";
import type { NetLeg } from "./edits.js";

const stringEqual = equalFor(StringType);

/** What an entity is: an item, a zone, a link or a net. */
export type SchematicSort = "item" | "zone" | "link" | "net";

/** An entity the drawing draws: its sort and its reference. */
export interface SchematicDrawnEntity {
    readonly sort: SchematicSort;
    readonly ref: SchematicRef;
}

/** An item with no position, as Details shows it (#1394): its id, its reference, its label and its icon, as its Backlog card has them. */
export interface SchematicUnplaced {
    /** Its id: its reference, printed, and its Backlog card's key. */
    readonly id: string;
    /** Its kind's slot and its key. */
    readonly ref: SchematicRef;
    /** Its label. */
    readonly label: string;
    /** Its own icon, where its row gives one. */
    readonly icon: string | undefined;
}

/** What Details shows: the drawing, one entity, a net's leg, several, or an item with no position. */
export type SchematicInspected =
    | { readonly view: "drawing" }
    | { readonly view: "entity"; readonly sort: SchematicSort; readonly id: string; readonly ref: SchematicRef }
    | { readonly view: "leg"; readonly id: string; readonly ref: SchematicRef; readonly leg: NetLeg }
    | { readonly view: "several"; readonly entities: readonly (SchematicDrawnEntity & { readonly id: string })[] }
    | ({ readonly view: "unplaced" } & SchematicUnplaced);

/** Nothing selected: the drawing. */
export const NOTHING_INSPECTED: SchematicInspected = { view: "drawing" };

/**
 * Each entity the drawing draws, by its id: its sort and its reference.
 *
 * @param drawn - What the canvas draws
 * @returns The entities, by id
 */
export function drawnEntities(drawn: SchematicDrawn): ReadonlyMap<string, SchematicDrawnEntity> {
    const out = new Map<string, SchematicDrawnEntity>();
    for (const item of drawn.items) out.set(item.key, { sort: "item", ref: item.ref });
    for (const zone of drawn.zones) out.set(zone.key, { sort: "zone", ref: zone.ref });
    for (const link of drawn.links) out.set(link.key, { sort: "link", ref: link.ref });
    for (const net of drawn.nets) out.set(net.key, { sort: "net", ref: net.ref });
    return out;
}

/**
 * What Details shows for a selection (see the module docs).
 *
 * @param selection - What the canvas has selected, by id: the items, the zones, and the link or the net
 * @param leg - The selected net's leg, when a stub is selected; `null` for none
 * @param entities - Each entity the drawing draws ({@link drawnEntities})
 * @returns What Details shows
 */
export function inspectedOf(selection: ReadonlySet<string>, leg: NetLeg | null, entities: ReadonlyMap<string, SchematicDrawnEntity>): SchematicInspected {
    const held = [...selection].flatMap((id) => {
        const entity = entities.get(id);
        return entity === undefined ? [] : [{ id, ...entity }];
    });
    if (held.length === 0) return NOTHING_INSPECTED;
    if (held.length > 1) return { view: "several", entities: held };
    const one = held[0]!;
    if (one.sort === "net" && leg !== null) return { view: "leg", id: one.id, ref: one.ref, leg };
    return { view: "entity", sort: one.sort, id: one.id, ref: one.ref };
}

/**
 * Whether two of what Details shows are one: the same view of the same
 * entities, so what it holds need not move.
 *
 * @param a - What Details shows
 * @param b - What it showed
 * @returns Whether they show the same
 */
export function inspectedEqual(a: SchematicInspected, b: SchematicInspected): boolean {
    switch (a.view) {
        case "drawing": return b.view === "drawing";
        case "entity": return b.view === "entity" && stringEqual(a.id, b.id);
        case "leg": return b.view === "leg" && stringEqual(a.id, b.id) && a.leg.end === b.leg.end && stringEqual(a.leg.item, b.leg.item);
        case "several": return b.view === "several" && a.entities.length === b.entities.length && a.entities.every((e, i) => stringEqual(e.id, b.entities[i]!.id));
        case "unplaced": return b.view === "unplaced" && stringEqual(a.id, b.id) && stringEqual(a.label, b.label)
            && (a.icon === undefined ? b.icon === undefined : b.icon !== undefined && stringEqual(a.icon, b.icon));
    }
}

/** What an item is joined to: the links that run from or to it, and the nets it is a member of, each on its side. */
export interface SchematicJoins {
    readonly links: readonly DrawnLink[];
    readonly nets: readonly { readonly net: DrawnNet; readonly end: NetLeg["end"] }[];
}

/**
 * What an item is joined to, as the drawing holds it: each link from or to it,
 * and each net it is a member of — on its feeding side, else its fed side — in
 * the drawing's order.
 *
 * @param id - The item's id
 * @param drawn - What the canvas draws
 * @returns Its links and nets
 */
export function joinsOf(id: string, drawn: Pick<SchematicDrawn, "links" | "nets">): SchematicJoins {
    return {
        links: drawn.links.filter((link) => stringEqual(link.from, id) || stringEqual(link.to, id)),
        nets: drawn.nets.flatMap((net): { net: DrawnNet; end: NetLeg["end"] }[] => {
            if (net.sources.some((member) => stringEqual(member, id))) return [{ net, end: "source" }];
            if (net.destinations.some((member) => stringEqual(member, id))) return [{ net, end: "destination" }];
            return [];
        }),
    };
}
