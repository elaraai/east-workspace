/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure derived-model helpers for the Schematic renderer (#183 WS3): the
 * navigator tree (zones nest by containment, items live in their smallest
 * outline host), the semantic-zoom LOD machinery (per-item tier sizing —
 * no card or pin wider than {@link SCHEMATIC_CARD_MAX_PX} — the centre
 * R-tree, and the symmetric neighbour-fit declutter) and the box the
 * narrowing's matches span (#1392). React-free data-in / data-out —
 * unit-tested in `model.test.ts`.
 */

import RBush from "rbush";
import { type DrawnItem as SchematicItemValue, type DrawnZone as SchematicZoneValue, type SchematicDrawn } from "./drawn";

export interface NavZone {
    zone: SchematicZoneValue;
    children: NavZone[];
    items: SchematicItemValue[];
}

/** Whether a zone's box holds a world point, its edges among it. */
const contains = (outer: SchematicZoneValue, x: number, y: number): boolean =>
    x >= outer.x && x <= outer.x + outer.width && y >= outer.y && y <= outer.y + outer.height;

/**
 * The zones that host items, smallest first: the outline zones — a hatched
 * one is an annotation (an aisle, an exclusion zone), never a container.
 *
 * @param zones - The zones
 * @returns The hosts, by their boxes' areas, smallest first
 */
export function hostZones(zones: readonly SchematicZoneValue[]): SchematicZoneValue[] {
    return [...zones].sort((a, b) => (a.width * a.height) - (b.width * b.height)).filter(z => z.pattern.type === "outline");
}

/**
 * The zone an item at a world point is filed under: the smallest host whose
 * box holds the point — the Index's, and the zone a drop's words say a card
 * lands in (#1390).
 *
 * @param hosts - The hosts, smallest first ({@link hostZones})
 * @param x - The point's world x
 * @param y - The point's world y
 * @returns The zone, or `undefined` for a point no host holds
 */
export function zoneHolding(hosts: readonly SchematicZoneValue[], x: number, y: number): SchematicZoneValue | undefined {
    return hosts.find(z => contains(z, x, y));
}

/** Nest zones by smallest-containing-rect and place items into their
 * smallest containing zone — the drawing IS the hierarchy. Hatch zones
 * are annotations (aisles, exclusion zones), not containers: they
 * never host items. */
export function buildNavTree(zones: readonly SchematicZoneValue[], items: readonly SchematicItemValue[]): { roots: NavZone[]; floor: SchematicItemValue[]; zoneOf: Map<string, string>; parentOf: Map<string, string> } {
    const nodes = new Map<string, NavZone>();
    const sorted = [...zones].sort((a, b) => (a.width * a.height) - (b.width * b.height));
    for (const zone of zones) nodes.set(zone.key, { zone, children: [], items: [] });

    const roots: NavZone[] = [];
    const parentOf = new Map<string, string>();
    for (const zone of zones) {
        const parent = sorted.find(p => p.key !== zone.key
            && p.width * p.height > zone.width * zone.height
            && contains(p, zone.x + zone.width / 2, zone.y + zone.height / 2));
        if (parent !== undefined) {
            nodes.get(parent.key)!.children.push(nodes.get(zone.key)!);
            parentOf.set(zone.key, parent.key);
        } else roots.push(nodes.get(zone.key)!);
    }
    const hosts = hostZones(zones);
    const floor: SchematicItemValue[] = [];
    const zoneOf = new Map<string, string>();
    for (const item of items) {
        const host = zoneHolding(hosts, item.x, item.y);
        if (host !== undefined) {
            nodes.get(host.key)!.items.push(item);
            zoneOf.set(item.key, host.key);
        } else floor.push(item);
    }
    return { roots, floor, zoneOf, parentOf };
}

export type LodTier = "card" | "label" | "dot";

/**
 * The widest an item's card or labelled pin draws, in screen px, whatever its
 * words (#1393): a longer label, sublabel or figure ends in an ellipsis. A card
 * drawn at its item's own width — its `width` role, a box in the world — is
 * held to that instead. Past the viewport a card reaches no more than half of
 * it, which is what a kind read by area pads its window by (`area.ts`).
 */
export const SCHEMATIC_CARD_MAX_PX = 200;

/** Screen-px footprint of an item rendered at `tier`, centred on the
 * item — a card or a pin at most {@link SCHEMATIC_CARD_MAX_PX} wide, but a
 * card at its item's own width. Translation-invariant, so collisions depend
 * on ppu alone. */
export function tierSize(item: SchematicItemValue, tier: LodTier, ppu: number): { w: number; h: number } {
    if (tier === "label") return { w: Math.min(SCHEMATIC_CARD_MAX_PX, item.label.length * 6 + 28), h: 22 };
    const sublabel = item.sublabel.type === "some" ? item.sublabel.value : undefined;
    const explicit = item.width.type === "some" ? item.width.value * ppu : undefined;
    const w = explicit ?? Math.min(SCHEMATIC_CARD_MAX_PX, Math.max(
        88,
        item.label.length * 6.6 + (item.icon.type === "some" ? 16 : 0) + (item.status.type === "some" ? 13 : 0) + 20,
        (sublabel?.length ?? 0) * 5.4 + 20,
    ));
    const h = 24
        + (sublabel !== undefined ? 13 : 0)
        + (item.meter.type === "some" ? 8 : 0)
        + (item.metric.type === "some" ? 15 : 0);
    return { w, h };
}

/** Per-item semantic-zoom tier. The global ppu band picks the richest
 * candidate form; a symmetric nearest-neighbour test then demotes items
 * (card ⇢ labelled dot ⇢ dot). Symmetry is the point: an item only
 * keeps a form if it AND its neighbours would fit at that form, so a
 * uniformly dense row degrades as one block instead of checkerboarding
 * into random survivors, while isolated items keep full cards at the
 * same zoom. Neighbourhoods come from per-item R-tree queries. */
export type CenterBox = { minX: number; minY: number; maxX: number; maxY: number; item: SchematicItemValue };

/** World-coordinate R-tree over item centres — built once per visible
 * set; zooming only changes the (1/ppu-scaled) query boxes. */
export function buildCenterTree(items: readonly SchematicItemValue[]): RBush<CenterBox> {
    const tree = new RBush<CenterBox>();
    tree.load(items.map(item => ({ minX: item.x, minY: item.y, maxX: item.x, maxY: item.y, item })));
    return tree;
}

export function declutterTiers(items: readonly SchematicItemValue[], tree: RBush<CenterBox>, baseLod: LodTier, ppu: number, selected: ReadonlySet<string>): Map<string, LodTier> {
    const tiers = new Map<string, LodTier>();
    if (baseLod === "dot") {
        for (const item of items) tiers.set(item.key, "dot");
        return tiers;
    }
    const GAP = 6;
    let maxW = 0, maxH = 0;
    const sizes = new Map<string, { card: { w: number; h: number }; label: { w: number; h: number } }>();
    for (const item of items) {
        const card = tierSize(item, "card", ppu);
        const label = tierSize(item, "label", ppu);
        sizes.set(item.key, { card, label });
        maxW = Math.max(maxW, card.w);
        maxH = Math.max(maxH, card.h);
    }
    // Clear of every neighbour when self renders at `tier` and each
    // neighbour at its own already-decided tier (or `tier` while undecided).
    const clear = (item: SchematicItemValue, tier: "card" | "label"): boolean => {
        const self = sizes.get(item.key)![tier];
        const reachX = ((self.w + maxW) / 2 + GAP) / ppu, reachY = ((self.h + maxH) / 2 + GAP) / ppu;
        for (const hit of tree.search({ minX: item.x - reachX, minY: item.y - reachY, maxX: item.x + reachX, maxY: item.y + reachY })) {
            if (hit.item.key === item.key) continue;
            const neighbourTier = tiers.get(hit.item.key);
            if (neighbourTier === "dot") continue;
            const other = sizes.get(hit.item.key) ?? { card: tierSize(hit.item, "card", ppu), label: tierSize(hit.item, "label", ppu) };
            const otherSize = other[neighbourTier === "label" ? "label" : tier];
            if (Math.abs(hit.item.x - item.x) * ppu < (self.w + otherSize.w) / 2 + GAP
                && Math.abs(hit.item.y - item.y) * ppu < (self.h + otherSize.h) / 2 + GAP) return false;
        }
        return true;
    };
    if (baseLod === "card") {
        for (const item of items) if (clear(item, "card")) tiers.set(item.key, "card");
    }
    for (const item of items) {
        if (!tiers.has(item.key)) tiers.set(item.key, clear(item, "label") ? "label" : "dot");
    }
    // A selected item is an explicit pointer — it never demotes below
    // the zoom band's richest form.
    for (const key of selected) if (tiers.has(key)) tiers.set(key, baseLod);
    return tiers;
}

/** A world box: its least and its greatest corner. */
export interface WorldBox { minX: number; minY: number; maxX: number; maxY: number }

/**
 * The world box the narrowing's matches span (#1392, §10.3): each matched
 * item drawn — by its centre grown by `reach`, and by its footprint about it
 * (D22) — each matched zone's box and its shape about the box's centre, and
 * each matched link's or net's members drawn and its bends. What the frame
 * boxes, and what fit flies to.
 *
 * @param drawn - What the canvas draws: its items where a Move's preview has them, a hidden layer's left out
 * @param matches - The matches, by id
 * @param hidden - What a hidden layer holds, by id: never drawn, so spanning nothing
 * @param centers - Each item drawn's centre, by id
 * @param reach - An item's half-extent about its centre, in world units
 * @returns The box, and how many matches it spans; `undefined` while none is drawn
 */
export function matchesExtent(
    drawn: SchematicDrawn, matches: ReadonlySet<string>, hidden: ReadonlySet<string>, centers: ReadonlyMap<string, { x: number; y: number }>,
    reach: (item: SchematicItemValue) => { readonly w: number; readonly h: number },
): { box: WorldBox; count: number } | undefined {
    if (matches.size === 0) return undefined;
    const box: WorldBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const take = (x: number, y: number) => {
        box.minX = Math.min(box.minX, x); box.minY = Math.min(box.minY, y);
        box.maxX = Math.max(box.maxX, x); box.maxY = Math.max(box.maxY, y);
    };
    /** A shape about an anchor: a circle's radius every way, a polygon's or a polyline's vertices. */
    const shape = (anchor: { x: number; y: number }, geometry: SchematicItemValue["footprint"]) => {
        if (geometry.type !== "some") return;
        const g = geometry.value;
        if (g.type === "circle") {
            take(anchor.x - g.value.radius, anchor.y - g.value.radius);
            take(anchor.x + g.value.radius, anchor.y + g.value.radius);
        } else if (g.type !== "rect") {
            for (const v of g.value.vertices) take(anchor.x + v.x, anchor.y + v.y);
        }
    };
    let count = 0;
    for (const item of drawn.items) {
        const c = matches.has(item.key) ? centers.get(item.key) : undefined;
        if (c === undefined) continue;
        count++;
        const r = reach(item);
        take(c.x - r.w, c.y - r.h);
        take(c.x + r.w, c.y + r.h);
        shape(c, item.footprint);
    }
    for (const zone of drawn.zones) {
        if (!matches.has(zone.key) || hidden.has(zone.key)) continue;
        count++;
        take(zone.x, zone.y);
        take(zone.x + zone.width, zone.y + zone.height);
        shape({ x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }, zone.geometry);
    }
    // A link or a net spans its members drawn and its bends: one drawn nowhere spans nothing.
    const edge = (key: string, members: readonly string[], via: readonly { x: number; y: number }[], whole: boolean) => {
        if (!matches.has(key) || hidden.has(key)) return;
        const at = members.flatMap((member) => { const c = centers.get(member); return c === undefined ? [] : [c]; });
        if (at.length === 0 || (whole && at.length < members.length)) return;
        count++;
        for (const p of [...at, ...via]) take(p.x, p.y);
    };
    for (const link of drawn.links) edge(link.key, [link.from, link.to], link.via, true);
    for (const net of drawn.nets) edge(net.key, [...net.sources, ...net.destinations], net.via, false);
    return count === 0 ? undefined : { box, count };
}
