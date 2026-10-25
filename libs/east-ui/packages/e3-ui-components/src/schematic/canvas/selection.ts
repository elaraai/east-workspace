/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure selection logic for the Schematic renderer — the marquee hit
 * collection (#159), and the link or the net under a point (#1403): the links'
 * R-tree, which a pointer's hover, a tap and a drop search, so what they cost
 * is what is near the point, never every link. React-free and DOM-free so every
 * rule the interaction layer relies on is unit-testable in a `node`
 * environment (see `selection.test.ts`), mirroring the `camera.ts` /
 * `paint.ts` split.
 *
 * @packageDocumentation
 */

import RBush from "rbush";
import { LINK_HIT_REACH } from "../../shared/links/look.js";
import type { NetLeg } from "../edits.js";
import { pointsBbox } from "./camera";
import { type DrawnItem, type DrawnLink, type DrawnNet } from "./drawn";
import { LINK_LANE_GAP, distanceToPolyline, edgeWeight, type EdgeGeometry } from "./routes";

/** An axis-aligned world-space box over an item, as stored in the culling R-tree. */
export interface ItemBox { minX: number; minY: number; maxX: number; maxY: number; item: DrawnItem }

/** Shared empty key set (stable identity — never churns memos / paint dedup). */
export const EMPTY_STRING_SET: ReadonlySet<string> = new Set();

/**
 * Collect the items a marquee region selects: an R-tree sweep, then a
 * CENTER-in-region test (the index boxes are padded for culling, so bare
 * overlap would over-select), skipping locked items and narrowed-out items
 * drawn dimmed (context, not targets). Layer-hidden items never reach the tree.
 *
 * @param tree - the world-space culling R-tree over the working item set
 * @param region - the swept world rectangle
 * @param lockedKeys - keys in a locked layer (non-selectable)
 * @param excludedKeys - narrowed-out keys drawn dimmed (non-selectable)
 * @returns the selected item keys
 */
export function marqueeHits(
    tree: RBush<ItemBox>,
    region: { minX: number; minY: number; maxX: number; maxY: number },
    lockedKeys: ReadonlySet<string>,
    excludedKeys: ReadonlySet<string>,
): Set<string> {
    const hits = new Set<string>();
    for (const b of tree.search(region)) {
        const k = b.item.key;
        if (lockedKeys.has(k)) continue;
        if (excludedKeys.has(k)) continue;
        if (b.item.x < region.minX || b.item.x > region.maxX || b.item.y < region.minY || b.item.y > region.maxY) continue;
        hits.add(k);
    }
    return hits;
}

/** A link's or a net's world box in the links' R-tree, by its id. */
export interface LinkBox { minX: number; minY: number; maxX: number; maxY: number; id: string }

/** The links' and the nets' R-tree, and how far past a box its link's drawn route reaches, at most. */
export interface LinkIndex {
    /** Each link's and net's world box: the centres of the items it joins drawn, and its bends. */
    readonly tree: RBush<LinkBox>;
    /** How far past its box a link's route takes the pointer, at most: its lane, half its weight and the hit reach (px). */
    readonly reach: number;
}

/**
 * The links' R-tree (#1403): each link's and each net's world box over the
 * centres of the items it joins drawn and its bends — its route runs inside it,
 * but for its lane and its weight, which the search reaches past
 * ({@link LinkIndex}'s `reach`). A link on a hidden layer, or one an item it
 * joins isn't drawn for, is left out, as the painter leaves it out.
 *
 * @param links - The links
 * @param nets - The nets
 * @param centers - Each item drawn's centre, by its id
 * @param hidden - What a hidden layer holds, by id
 * @param lanes - The links' lanes (`parallelLanes`)
 * @returns The index
 */
export function linkIndex(
    links: readonly DrawnLink[], nets: readonly DrawnNet[], centers: ReadonlyMap<string, { x: number; y: number }>, hidden: ReadonlySet<string>,
    lanes: ReadonlyMap<string, { i: number; n: number }>,
): LinkIndex {
    const boxes: LinkBox[] = [];
    let half = 0;
    for (const link of links) {
        const from = centers.get(link.from), to = centers.get(link.to);
        if (hidden.has(link.key) || from === undefined || to === undefined) continue;
        const box = pointsBbox([from, ...link.via, to]);
        if (box !== null) boxes.push({ ...box, id: link.key });
        half = Math.max(half, edgeWeight(link.style) / 2);
    }
    for (const net of nets) {
        if (hidden.has(net.key) || !net.sources.some((k) => centers.has(k)) || !net.destinations.some((k) => centers.has(k))) continue;
        const members = [...net.sources, ...net.destinations].flatMap((k) => { const c = centers.get(k); return c === undefined ? [] : [c]; });
        const box = pointsBbox([...members, ...net.via]);
        if (box !== null) boxes.push({ ...box, id: net.key });
        half = Math.max(half, (edgeWeight(net.style) + 1) / 2);
    }
    let lane = 0;
    for (const { i, n } of lanes.values()) lane = Math.max(lane, Math.abs(i - (n - 1) / 2) * LINK_LANE_GAP);
    const tree = new RBush<LinkBox>();
    tree.load(boxes);
    return { tree, reach: lane + half + LINK_HIT_REACH };
}

/**
 * The link or the net under a point, and the net's leg it is on (#1403): of
 * those whose boxes the R-tree holds near the point, the nearest whose drawn
 * route — each run to its head's tip — the point lies within its weight and the
 * hit reach of; a net's trunk and bars are the whole net, a leg its leg. Only
 * those near the point have their routes asked.
 *
 * @param index - The links' R-tree
 * @param routeOf - A link's or a net's drawing, by its id, as the painter draws it
 * @param world - The point, in world units
 * @param screen - The point, in the canvas's px
 * @param ppu - The camera's px a world unit
 * @param takes - Whether a link, or a net's leg, takes the point: none locked, none the narrowing leaves out
 * @returns The link or the net, and its leg; `undefined` for none
 */
export function linkAt(
    index: LinkIndex, routeOf: (id: string) => EdgeGeometry | undefined, world: { x: number; y: number }, screen: { x: number; y: number }, ppu: number,
    takes: (id: string, leg: NetLeg | null) => boolean,
): { key: string; leg: NetLeg | null } | undefined {
    const r = ppu > 0 ? index.reach / ppu : 0;
    let best: { key: string; leg: NetLeg | null } | undefined;
    let bestD = Infinity;
    for (const box of index.tree.search({ minX: world.x - r, minY: world.y - r, maxX: world.x + r, maxY: world.y + r })) {
        const geometry = routeOf(box.id);
        if (geometry === undefined) continue;
        for (const run of geometry.runs) {
            const leg: NetLeg | null = run.leg === undefined ? null : run.leg;
            if (!takes(box.id, leg)) continue;
            const d = distanceToPolyline(run.route, screen.x, screen.y);
            if (d <= run.width / 2 + LINK_HIT_REACH && d < bestD) { best = { key: box.id, leg }; bestD = d; }
        }
    }
    return best;
}
