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
 * Each entity has one name, wherever the Schematic says it
 * ({@link entityNames}): an item's or a zone's label; a link's ends; a net's
 * label, else its ends — never a key the Schematic minted for a new link or net.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import { refOfId, type DrawnLink, type DrawnNet, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import type { NetLeg } from "./edits.js";
import type { SchematicMembers, SchematicWords } from "./messages.js";

const stringEqual = equalFor(StringType);

/** How many of a net's members on a side its name lists by name, before it counts the rest. */
const NAMED_MEMBERS = 3;

/** A member's name, where a link or a net names it: its label as drawn, else the key its id names. */
function memberName(id: string, labelOf: (id: string) => string | undefined): string {
    return labelOf(id) ?? refOfId(id)?.key ?? id;
}

/** A link's name: its ends' items — `A04 → CORE-1`. */
function linkName(link: DrawnLink, labelOf: (id: string) => string | undefined, words: SchematicWords): string {
    return words.m.linkEnds({ from: memberName(link.from, labelOf), to: memberName(link.to, labelOf) });
}

/** A net's name: its label, else its ends — its sources, then its destinations, each side's first three and how many more. */
function netName(net: DrawnNet, labelOf: (id: string) => string | undefined, words: SchematicWords): string {
    if (net.label.type === "some") return net.label.value;
    const side = (ids: readonly string[]): SchematicMembers => {
        const names = ids.slice(0, NAMED_MEMBERS).map((id) => memberName(id, labelOf));
        const more = ids.length - names.length;
        return { names, more: more > 0 ? { n: more, count: words.number(more) } : undefined };
    };
    return words.m.netEnds({ sources: side(net.sources), destinations: side(net.destinations) });
}

/**
 * Each entity's name, as the Schematic says it wherever it names one (#1391) — the inspector's head and its collapsed
 * rail, what an item is joined to and a net's leg, a drop's words, an issue's row and a record's banners: an item's or a
 * zone's label; a link's ends, by their items' labels (`A04 → CORE-1`); a net's label, else its ends, its sources then
 * its destinations (`A03 → CORE-1, ODF-1`). Never a key the Schematic minted: a new link or net is named by what it joins.
 *
 * @param drawn - What the canvas draws
 * @param words - The Schematic's words
 * @returns Each entity's name, by its id
 */
export function entityNames(drawn: SchematicDrawn, words: SchematicWords): ReadonlyMap<string, string> {
    const out = new Map<string, string>();
    for (const item of drawn.items) out.set(item.key, item.label);
    for (const zone of drawn.zones) out.set(zone.key, zone.label);
    const labelOf = (id: string) => out.get(id);
    for (const link of drawn.links) out.set(link.key, linkName(link, labelOf, words));
    for (const net of drawn.nets) out.set(net.key, netName(net, labelOf, words));
    return out;
}

/**
 * An entity's name, as {@link entityNames} named it — or, for one the drawing doesn't draw, the key its id names.
 *
 * @param names - Each entity's name, by its id ({@link entityNames})
 * @param id - The entity's id
 * @returns Its name
 */
export function nameOfEntity(names: ReadonlyMap<string, string>, id: string): string {
    return names.get(id) ?? refOfId(id)?.key ?? id;
}

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
