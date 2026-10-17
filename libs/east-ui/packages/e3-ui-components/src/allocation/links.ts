/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Timeline's links (`Allocation Spec.md` §11, A65–A68), pure: which links
 * the focus draws — its family, each part of each bin on it — and where each
 * runs, routed by Plan's grammar (`shared/links/`) from the bin card's right
 * edge to its resource row's leading edge, through the link channel. Nothing
 * of a link leaves the lane grid's card columns or crosses into the resource
 * pane; an end out of its pane's view meets the view's edge in Plan's stub.
 *
 * @packageDocumentation
 */

import { placeCaptions, ribbonWeight } from "../shared/links/captions.js";
import { routeRibbon, type RibbonEnd } from "../shared/links/geometry.js";
import type { LinkRibbon } from "../shared/links/layer.js";
import { CARD_H, CARD_INSET, CARD_W, HOUR_W, LANE_W, ROW_H, type LaneCard } from "./timeline-layout.js";
import { compareDate, compareFloat, compareString, partsOf, type Day } from "./model.js";

/** One link of the family: a bin's part on a resource. */
export interface FamilyLink {
    /** Its identity in the layer. */
    id: number;
    bin: string;
    resource: string;
    /** Its quantity; `undefined` for a reservation's, which draws thin and has no caption. */
    quantity: number | undefined;
    /** Whether the drafts changed it: its bin new, or this part not as the day holds it. */
    draft: boolean;
}

/**
 * The focus's family (A65, A72): every bin with a part on the focus, by time,
 * and each of its parts — a split bin shows a link to each of its resources.
 *
 * @param plan - The day as drafted
 * @param held - The day as the record holds it
 * @param focus - The focus's resource
 * @returns The links, in drawing order
 */
export function familyOf(plan: Day, held: Day | undefined, focus: string): FamilyLink[] {
    const bins = [...plan.bins].filter(([, bin]) => bin.parts.has(focus))
        .sort(([a, x], [b, y]) => compareDate(x.at, y.at) || compareString(a, b));
    const links: FamilyLink[] = [];
    for (const [id, bin] of bins) {
        const committed = held?.bins.get(id);
        for (const part of partsOf(bin)) {
            const was = committed?.parts.get(part.key);
            links.push({
                id: links.length, bin: id, resource: part.key,
                quantity: bin.event.type === "none" ? undefined : part.quantity,
                draft: was === undefined || compareFloat(was, part.quantity) !== 0,
            });
        }
    }
    return links;
}

/** Where the links run: the layer's px, as the panes stand. */
export interface LinkView {
    /** The lane grid's left edge: where its hour column starts. */
    gridLeft: number;
    /** The link channel's right edge: every resource row's leading edge. */
    channelRight: number;
    /** The panes' view under their heads, its height. */
    height: number;
    /** How far the lane grid and the resource rows have scrolled. */
    laneTop: number;
    rowsTop: number;
}

/**
 * Routes the family (A66): each link from its card to its row, weighted by its
 * share of the family's largest quantity, its caption its quantity.
 *
 * @param family - The links
 * @param cards - Each bin's card, by bin
 * @param rows - Each shown resource row's index, by key: a link to a row the narrowing hides is not drawn
 * @param view - Where the links run
 * @param label - A link's caption
 * @param selected - The selected link: drawn a px heavier, in the ink
 * @returns The routed links
 */
export function layoutLinks(
    family: readonly FamilyLink[], cards: ReadonlyMap<string, LaneCard>, rows: ReadonlyMap<string, number>, view: LinkView,
    label: (link: FamilyLink) => string | undefined, selected?: number | undefined,
): (LinkRibbon & { link: FamilyLink })[] {
    const largest = Math.max(0, ...family.map(l => l.quantity ?? 0));
    const bounds = { left: view.gridLeft + HOUR_W, right: view.channelRight };
    // An end out of its pane's view sits on the edge it lies beyond.
    const clamp = (end: RibbonEnd): RibbonEnd => {
        if (end.bottom <= 0) return { ...end, top: 0, bottom: 0, off: "above" };
        if (end.top >= view.height) return { ...end, top: view.height, bottom: view.height, off: "below" };
        return end;
    };
    const out: (LinkRibbon & { link: FamilyLink })[] = [];
    for (const link of family) {
        const card = cards.get(link.bin), row = rows.get(link.resource);
        if (card === undefined || row === undefined) continue;
        const leftX = view.gridLeft + HOUR_W + card.lane * LANE_W + CARD_INSET, top = card.row * ROW_H + CARD_INSET - view.laneTop;
        const from = clamp({ leftX, rightX: leftX + CARD_W, top, bottom: top + CARD_H });
        const at = row * ROW_H - view.rowsTop;
        const to = clamp({ leftX: view.channelRight, rightX: view.channelRight, top: at, bottom: at + ROW_H });
        // Both ends past the same edge: nothing in view to draw.
        if (from.off !== undefined && from.off === to.off) continue;
        const width = ribbonWeight(link.quantity, largest) + (link.id === selected ? 1 : 0);
        out.push({ ...routeRibbon(from, to, width, bounds), id: link.id, from, to, label: link.quantity === undefined ? undefined : label(link), link,
            tone: link.draft ? "draft" : undefined });
    }
    placeCaptions(out, bounds.left, bounds.right);
    return out;
}
