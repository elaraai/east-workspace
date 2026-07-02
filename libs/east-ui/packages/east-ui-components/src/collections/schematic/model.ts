/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure derived-model helpers for the Schematic renderer (#183 WS3): the
 * navigator tree (zones nest by containment, items live in their smallest
 * outline host) and the semantic-zoom LOD machinery (per-item tier sizing,
 * the centre R-tree, and the symmetric neighbour-fit declutter). React-free
 * data-in / data-out — unit-tested in `model.test.ts`.
 */

import RBush from "rbush";
import { type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/east-ui/internal";

type SchematicItemValue = ValueTypeOf<typeof Schematic.Types.Item>;
type SchematicZoneValue = ValueTypeOf<typeof Schematic.Types.Zone>;

export interface NavZone {
    zone: SchematicZoneValue;
    children: NavZone[];
    items: SchematicItemValue[];
}

/** Nest zones by smallest-containing-rect and place items into their
 * smallest containing zone — the drawing IS the hierarchy. Hatch zones
 * are annotations (walkways, exclusion strips), not containers: they
 * never host items. */
export function buildNavTree(zones: readonly SchematicZoneValue[], items: readonly SchematicItemValue[]): { roots: NavZone[]; floor: SchematicItemValue[]; zoneOf: Map<string, string>; parentOf: Map<string, string> } {
    const nodes = new Map<string, NavZone>();
    const sorted = [...zones].sort((a, b) => (a.width * a.height) - (b.width * b.height));
    const contains = (outer: SchematicZoneValue, x: number, y: number) =>
        x >= outer.x && x <= outer.x + outer.width && y >= outer.y && y <= outer.y + outer.height;
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
    const hosts = sorted.filter(z => z.pattern.type === "outline");
    const floor: SchematicItemValue[] = [];
    const zoneOf = new Map<string, string>();
    for (const item of items) {
        const host = hosts.find(z => contains(z, item.x, item.y));
        if (host !== undefined) {
            nodes.get(host.key)!.items.push(item);
            zoneOf.set(item.key, host.key);
        } else floor.push(item);
    }
    return { roots, floor, zoneOf, parentOf };
}

export type LodTier = "card" | "label" | "dot";

/** Screen-px footprint of an item rendered at `tier`, centred on the
 * item. Translation-invariant, so collisions depend on ppu alone. */
export function tierSize(item: SchematicItemValue, tier: LodTier, ppu: number): { w: number; h: number } {
    if (tier === "label") return { w: item.label.length * 6 + 28, h: 22 };
    const sublabel = item.sublabel.type === "some" ? item.sublabel.value : undefined;
    const explicit = item.width.type === "some" ? item.width.value * ppu : undefined;
    const w = explicit ?? Math.max(
        88,
        item.label.length * 6.6 + (item.icon.type === "some" ? 16 : 0) + (item.status.type === "some" ? 13 : 0) + 20,
        (sublabel?.length ?? 0) * 5.4 + 20,
    );
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
