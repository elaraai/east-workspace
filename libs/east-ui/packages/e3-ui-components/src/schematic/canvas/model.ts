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

/**
 * Labels in natural order — `A2` before `A10`, `Cage 2` before `Cage 10` — as
 * the Index lists zones and items and the steps walk them.
 *
 * @param a - One labelled entity
 * @param b - Another
 * @returns Below zero where `a`'s label comes first, above where `b`'s does, else zero
 */
export function byLabel(a: { readonly label: string }, b: { readonly label: string }): number {
    return a.label.localeCompare(b.label, undefined, { numeric: true });
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

/** A labelled pin's parts, in screen px (#1393): its inline padding, its dot's width, the gap after the dot, and its height. */
export const PIN_PAD_X = 6, PIN_DOT_W = 7, PIN_GAP = 4, PIN_H = 16;

/** How far a labelled pin starts before its item's point, in screen px: its dot stands on the point, the words after it (#1393). */
export const PIN_LEAD_PX = PIN_PAD_X + PIN_DOT_W / 2;

/** A dot's radius as the declutter keeps clear of it, in screen px: the painter's dot (5) and its rule. */
const DOT_CLEAR_PX = 6;

/** The room kept between two items' marks, in screen px. */
const MARK_GAP_PX = 6;

/** How far short of its words a card may fall and still draw whole, in screen px: the float error of a zoom worked out to draw it whole. */
const WHOLE_SLACK_PX = 1e-6;

/**
 * The width a card takes for its words, in screen px (#1393): its label with
 * its icon and its dot beside it, or its sublabel, whichever is wider — no
 * narrower than a card's least and no wider than
 * {@link SCHEMATIC_CARD_MAX_PX}.
 *
 * @param item - The item
 * @returns Its card's width for its words
 */
export function cardContentWidth(item: SchematicItemValue): number {
    const sublabel = item.sublabel.type === "some" ? item.sublabel.value : undefined;
    return Math.min(SCHEMATIC_CARD_MAX_PX, Math.max(
        88,
        item.label.length * 6.6 + (item.icon.type === "some" ? 16 : 0) + (item.status.type === "some" ? 13 : 0) + 20,
        (sublabel?.length ?? 0) * 5.4 + 20,
    ));
}

/**
 * Whether an item's card draws whole at a zoom (#1393): a card held to its
 * item's own width — a box in the world — draws whole once that width holds
 * its words; any other card is as wide as its words. A zoom worked out to draw
 * it whole — the zoom's limit, a fly to it — draws it whole, its float error
 * among it.
 *
 * @param item - The item
 * @param ppu - The zoom, in px per world unit
 * @returns Whether its card draws whole
 */
export function cardWhole(item: SchematicItemValue, ppu: number): boolean {
    return item.width.type !== "some" || item.width.value * ppu + WHOLE_SLACK_PX >= cardContentWidth(item);
}

/** Screen-px footprint of an item rendered at `tier` — a card or a labelled pin, no wider than
 * {@link SCHEMATIC_CARD_MAX_PX}, but a card at its item's own width. A card is centred on its item; a pin's dot stands
 * on it, its words after ({@link PIN_LEAD_PX}). Translation-invariant, so collisions depend on ppu alone. */
export function tierSize(item: SchematicItemValue, tier: LodTier, ppu: number): { w: number; h: number } {
    if (tier === "label") return { w: Math.min(SCHEMATIC_CARD_MAX_PX, item.label.length * 6.6 + 2 * PIN_PAD_X + PIN_DOT_W + PIN_GAP), h: PIN_H };
    const sublabel = item.sublabel.type === "some" ? item.sublabel.value : undefined;
    const w = item.width.type === "some" ? item.width.value * ppu : cardContentWidth(item);
    const h = 24
        + (sublabel !== undefined ? 13 : 0)
        + (item.meter.type === "some" ? 8 : 0)
        + (item.metric.type === "some" ? 15 : 0);
    return { w, h };
}

/** An item by its centre in the world: what the declutter searches an item's neighbours in. */
export type CenterBox = { minX: number; minY: number; maxX: number; maxY: number; item: SchematicItemValue };

/** World-coordinate R-tree over item centres — built over every item drawn, so an item's neighbours past the viewport
 * count too; zooming only changes the (1/ppu-scaled) query boxes. */
export function buildCenterTree(items: readonly SchematicItemValue[]): RBush<CenterBox> {
    const tree = new RBush<CenterBox>();
    tree.load(items.map(item => ({ minX: item.x, minY: item.y, maxX: item.x, maxY: item.y, item })));
    return tree;
}

/** A box in screen px about an item's point: how far it reaches each way. */
interface Reach { readonly left: number; readonly right: number; readonly up: number; readonly down: number }

/** Whether two items' boxes, each about its own point, overlap with `gap` between them. */
function boxesMeet(a: SchematicItemValue, ra: Reach, b: SchematicItemValue, rb: Reach, ppu: number, gap: number): boolean {
    const ax = a.x * ppu, ay = a.y * ppu, bx = b.x * ppu, by = b.y * ppu;
    return ax - ra.left < bx + rb.right + gap && bx - rb.left < ax + ra.right + gap
        && ay - ra.up < by + rb.down + gap && by - rb.up < ay + ra.down + gap;
}

/**
 * Each visible item's tier at the zoom (#1393): a card, a labelled pin or a
 * dot. The zoom's band picks the richest form an item may take, and it takes
 * it only where it draws whole and clear of the items about it — decided from
 * where every item drawn stands, never from the order they come in nor which
 * of them the viewport holds, so a pan never changes what an item draws as,
 * and a uniformly dense row draws as one block rather than checkerboarding:
 *
 * - **a card** where the band is the card's and it draws whole
 *   ({@link cardWhole}), clear of every other item's dot and of every other
 *   card that could draw;
 * - **else a pin** where the band reaches the pin's, clear of every other
 *   item's mark — the card it draws as, or its dot — and of every other pin
 *   that could draw: no pin covers another item's status;
 * - **else a dot.**
 *
 * A selected item is an explicit pointer: it takes the richest form the band
 * gives that draws whole, whatever it covers.
 *
 * @param items - The items to decide: the viewport's
 * @param tree - Every item drawn, by its centre ({@link buildCenterTree}): what an item keeps clear of
 * @param baseLod - The zoom's band
 * @param ppu - The zoom, in px per world unit
 * @param selected - What is selected, by id
 * @returns Each item's tier, by its id
 */
export function declutterTiers(items: readonly SchematicItemValue[], tree: RBush<CenterBox>, baseLod: LodTier, ppu: number, selected: ReadonlySet<string>): Map<string, LodTier> {
    const tiers = new Map<string, LodTier>();
    if (baseLod === "dot" || !(ppu > 0)) {
        for (const item of items) tiers.set(item.key, "dot");
        return tiers;
    }
    // How far any card or pin reaches, in world units: what an item's neighbours are searched within.
    let widest = SCHEMATIC_CARD_MAX_PX, tallest = PIN_H;
    for (const { item } of tree.all()) {
        const card = tierSize(item, "card", ppu);
        widest = Math.max(widest, card.w);
        tallest = Math.max(tallest, card.h);
    }
    const dotReach: Reach = { left: DOT_CLEAR_PX, right: DOT_CLEAR_PX, up: DOT_CLEAR_PX, down: DOT_CLEAR_PX };
    const cardReach = (item: SchematicItemValue): Reach => {
        const { w, h } = tierSize(item, "card", ppu);
        return { left: w / 2, right: w / 2, up: h / 2, down: h / 2 };
    };
    const pinReach = (item: SchematicItemValue): Reach => {
        const { w, h } = tierSize(item, "label", ppu);
        return { left: PIN_LEAD_PX, right: w - PIN_LEAD_PX, up: h / 2, down: h / 2 };
    };
    const near = (item: SchematicItemValue): SchematicItemValue[] => {
        const rx = (widest + MARK_GAP_PX + DOT_CLEAR_PX) / ppu, ry = (tallest + MARK_GAP_PX + DOT_CLEAR_PX) / ppu;
        return tree.search({ minX: item.x - rx, minY: item.y - ry, maxX: item.x + rx, maxY: item.y + ry })
            .map((hit) => hit.item).filter((other) => other.key !== item.key);
    };
    const mayCard = (item: SchematicItemValue): boolean => baseLod === "card" && cardWhole(item, ppu);
    // Cards: each one that could draw, clear of every other's dot and every other card that could draw.
    const cards = new Map<string, boolean>();
    const isCard = (item: SchematicItemValue): boolean => {
        const known = cards.get(item.key);
        if (known !== undefined) return known;
        let card = mayCard(item);
        if (card) {
            const reach = cardReach(item);
            for (const other of near(item)) {
                if (boxesMeet(item, reach, other, dotReach, ppu, MARK_GAP_PX) || (mayCard(other) && boxesMeet(item, reach, other, cardReach(other), ppu, MARK_GAP_PX))) {
                    card = false;
                    break;
                }
            }
        }
        cards.set(item.key, card);
        return card;
    };
    // Pins: each one clear of every other's mark, and of every other pin that could draw.
    const isPin = (item: SchematicItemValue): boolean => {
        const reach = pinReach(item);
        for (const other of near(item)) {
            const card = isCard(other);
            if (boxesMeet(item, reach, other, card ? cardReach(other) : dotReach, ppu, MARK_GAP_PX)) return false;
            if (!card && boxesMeet(item, reach, other, pinReach(other), ppu, MARK_GAP_PX)) return false;
        }
        return true;
    };
    for (const item of items) {
        if (selected.has(item.key)) tiers.set(item.key, mayCard(item) ? "card" : "label");
        else tiers.set(item.key, isCard(item) ? "card" : isPin(item) ? "label" : "dot");
    }
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
