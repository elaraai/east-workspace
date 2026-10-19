/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Timeline's links (`Allocation Spec.md` §11, A65–A69, A30), pure: which
 * links the focus draws — its family, each part of each bin on it — and which a
 * drag draws instead — the dragged bin's resource's family and the target's —
 * and where each runs, routed by Plan's grammar (`shared/links/`) from the bin
 * card's right edge to its resource row's leading edge, through the link
 * channel. Nothing of a link leaves the lane grid's card columns or crosses
 * into the resource pane; an end out of its pane's view meets the view's edge
 * in Plan's stub. A link drag's new line runs from its card to the pointer, and
 * an event's drag over the lane grid draws thin lines from the pointer into its
 * three best fits' rows.
 *
 * @packageDocumentation
 */

import { placeCaptions, ribbonWeight } from "../shared/links/captions.js";
import { RIBBON_CORNER, RIBBON_RISER, rounded, routeRibbon, type RibbonEnd } from "../shared/links/geometry.js";
import type { LinkLine, LinkRibbon } from "../shared/links/layer.js";
import { CARD_H, CARD_INSET, CARD_W, HOUR_W, LANE_W, ROW_H, type LaneCard } from "./timeline-layout.js";
import { compareDate, compareFloat, compareString, partsOf, type Day } from "./model.js";

/** How a drag draws a link of its families (A65, A69): the link it moves, faded to its `was` line, or the target's verdict on it. */
export type LinkLook = "was" | "fits" | "refused";

/** One link of the family: a bin's part on a resource. */
export interface FamilyLink {
    /** Its identity in the layer: the same for the same link in a focus's family and a drag's (`linkIds`). */
    id: number;
    bin: string;
    resource: string;
    /** Its quantity; `undefined` for a reservation's, which draws thin and has no caption. */
    quantity: number | undefined;
    /** Whether the drafts changed it: its bin new, or this part not as the day holds it. */
    draft: boolean;
    /** How a drag draws it; at rest, plain. */
    look?: LinkLook | undefined;
    /** The family it is drawn in, by its resource: what its weight is a share of (A66). */
    family: string;
}

/** Every link of the day, by its bin and then its resource: its identity in the layer. */
export type LinkIds = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * Every link of the day, numbered once — its bins by time, each bin's parts
 * largest first — so a link keeps its identity in the layer, and the grip the
 * layer draws for it, whichever family it is drawn in: a drag that starts on a
 * focus's link goes on drawing it as the drag's (A69).
 *
 * @param plan - The day as drafted
 * @returns Each link's id, by its bin and its resource
 */
export function linkIds(plan: Day): LinkIds {
    const ids = new Map<string, Map<string, number>>();
    let next = 0;
    for (const [id, bin] of [...plan.bins].sort(([a, x], [b, y]) => compareDate(x.at, y.at) || compareString(a, b))) {
        ids.set(id, new Map(partsOf(bin).map(part => [part.key, next++] as const)));
    }
    return ids;
}

/**
 * The focus's family (A65, A72): every bin with a part on the focus, by time,
 * and each of its parts — a split bin shows a link to each of its resources.
 *
 * @param plan - The day as drafted
 * @param held - The day as the record holds it
 * @param focus - The focus's resource
 * @param ids - Every link's identity: the day's own by default
 * @returns The links, in drawing order
 */
export function familyOf(plan: Day, held: Day | undefined, focus: string, ids: LinkIds = linkIds(plan)): FamilyLink[] {
    const bins = [...plan.bins].filter(([, bin]) => bin.parts.has(focus))
        .sort(([a, x], [b, y]) => compareDate(x.at, y.at) || compareString(a, b));
    const links: FamilyLink[] = [];
    for (const [id, bin] of bins) {
        const committed = held?.bins.get(id);
        for (const part of partsOf(bin)) {
            const was = committed?.parts.get(part.key);
            links.push({
                id: ids.get(id)?.get(part.key) ?? -1, bin: id, resource: part.key,
                quantity: bin.event.type === "none" ? undefined : part.quantity,
                draft: was === undefined || compareFloat(was, part.quantity) !== 0, family: focus,
            });
        }
    }
    return links;
}

/** A link a drag moves: its bin's part on a resource. */
export interface MovedLink { bin: string; resource: string }

/** Where a drag rests, for its links: a resource other than the dragged bin's, and the drop's verdict there — `undefined` while the fit's answer is on its way. */
export interface DragTarget { resource: string; verdict: "fits" | "refused" | undefined }

/**
 * The links a drag draws in the focus's place (A65): the dragged bin's
 * resource's family, the link it moves faded to its `was` line (A69), and the
 * family of the resource the drag rests on, its links there in the drop's
 * verdict — ink-2 where it fits, warn where it refuses; a draft link keeps its
 * brand — as the mock draws them: the plain ones first, then the target's, the
 * `was` line over them all. A link in both families is drawn once.
 *
 * @param plan - The day as drafted
 * @param held - The day as the record holds it
 * @param ids - Every link's identity
 * @param current - The dragged bin's resource; `undefined` for a drag of no bin's (a Library card)
 * @param moved - The link the drag moves, if it moves one
 * @param target - The resource the drag rests on, if it is not `current`, and the verdict there
 * @returns The links, in drawing order
 */
export function dragFamilies(plan: Day, held: Day | undefined, ids: LinkIds, current: string | undefined, moved: MovedLink | undefined,
    target: DragTarget | undefined): FamilyLink[] {
    const links = new Map<number, FamilyLink>();
    for (const resource of [current, target?.resource]) {
        if (resource !== undefined) for (const link of familyOf(plan, held, resource, ids)) if (!links.has(link.id)) links.set(link.id, link);
    }
    const looked = [...links.values()].map((link): FamilyLink => {
        // A link into either resource is weighed in that resource's family, whichever family found it first.
        const own = link.resource === current || link.resource === target?.resource ? { ...link, family: link.resource } : link;
        if (moved !== undefined && link.bin === moved.bin && link.resource === moved.resource) return { ...own, look: "was" };
        return target !== undefined && target.verdict !== undefined && link.resource === target.resource ? { ...own, look: target.verdict } : own;
    });
    const layer = (link: FamilyLink) => link.look === "was" ? 2 : link.look === undefined ? 0 : 1;
    return looked.sort((a, b) => layer(a) - layer(b));
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

/** An end out of its pane's view sits on the edge it lies beyond. */
function inView(end: RibbonEnd, height: number): RibbonEnd {
    if (end.bottom <= 0) return { ...end, top: 0, bottom: 0, off: "above" };
    if (end.top >= height) return { ...end, top: height, bottom: height, off: "below" };
    return end;
}

/** A bin's card, in the layer's px, as its lane grid has scrolled. */
export function cardEnd(card: LaneCard, view: LinkView): RibbonEnd {
    const leftX = view.gridLeft + HOUR_W + card.lane * LANE_W + CARD_INSET, top = card.row * ROW_H + CARD_INSET - view.laneTop;
    return { leftX, rightX: leftX + CARD_W, top, bottom: top + CARD_H };
}

/** A resource row's leading edge, in the layer's px, as the rows have scrolled: where every link into it arrives. */
function rowEnd(row: number, view: LinkView): RibbonEnd {
    const at = row * ROW_H - view.rowsTop;
    return { leftX: view.channelRight, rightX: view.channelRight, top: at, bottom: at + ROW_H };
}

/**
 * Routes the links (A66): each from its card to its row, weighted by its
 * share of its family's largest quantity, its caption its quantity; in a
 * drag's families (A65) the link it moves carries no tone of its own, a draft
 * keeps the brand's, and a link into the target takes the verdict's.
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
    // Each family's largest quantity: what its links' weights are a share of.
    const largest = new Map<string, number>();
    for (const l of family) largest.set(l.family, Math.max(largest.get(l.family) ?? 0, l.quantity ?? 0));
    const bounds = { left: view.gridLeft + HOUR_W, right: view.channelRight };
    const out: (LinkRibbon & { link: FamilyLink })[] = [];
    for (const link of family) {
        const card = cards.get(link.bin), row = rows.get(link.resource);
        if (card === undefined || row === undefined) continue;
        const from = inView(cardEnd(card, view), view.height);
        const to = inView(rowEnd(row, view), view.height);
        // Both ends past the same edge: nothing in view to draw.
        if (from.off !== undefined && from.off === to.off) continue;
        const width = ribbonWeight(link.quantity, largest.get(link.family) ?? 0) + (link.id === selected ? 1 : 0);
        out.push({ ...routeRibbon(from, to, width, bounds), id: link.id, from, to, label: link.quantity === undefined ? undefined : label(link), link,
            tone: link.look === "was" ? undefined : link.draft ? "draft" : link.look });
    }
    placeCaptions(out, bounds.left, bounds.right);
    return out;
}

/** How far past its card the pointer must be before a link drag's new line shows (px). */
const LINE_CLEAR = 16;
/** The least a new line runs out of its card before it turns (px). */
const LINE_OUT = 12;
/** How far short of the riser an event's drag still draws its guides (px). */
const GUIDE_CLEAR = 12;
const f = (n: number) => n.toFixed(1);

/**
 * A link drag's new line (A69), as the mock draws it: out of its card's right
 * edge level with the card's middle, to the riser — the links' own,
 * `RIBBON_RISER` before the rows' edge, once the pointer is past it, else
 * halfway to the pointer — up or down to the pointer, and on into a head 9
 * long and 12 across at the pointer. Nothing while the pointer is within 16px
 * of the card, or outside the panes under their head.
 *
 * @param from - The dragged bin's card, in the layer's px (`cardEnd`)
 * @param x - The pointer, across the layer
 * @param y - The pointer, down the layer
 * @param view - Where the links run
 * @returns The line, or `undefined` while it has nowhere to go
 */
export function dragLine(from: RibbonEnd, x: number, y: number, view: Pick<LinkView, "channelRight" | "height">): LinkLine | undefined {
    const x1 = from.rightX, y1 = (from.top + from.bottom) / 2;
    if (x <= x1 + LINE_CLEAR || y <= 0 || y >= view.height) return undefined;
    const riser = view.channelRight - RIBBON_RISER;
    const turn = x > riser ? riser : Math.max(x1 + LINE_OUT, (x1 + x) / 2);
    // A point within half a px of the one before it is the same corner: a pointer level with the card runs straight.
    const points = ([[x1, y1], [turn, y1], [turn, y], [x - 8, y]] as const)
        .filter((p, i, all) => i === 0 || Math.abs(p[0] - all[i - 1]![0]) + Math.abs(p[1] - all[i - 1]![1]) > 0.5);
    return {
        stroke: rounded(points, RIBBON_CORNER),
        head: `M ${f(x - 9)} ${f(y - 6)} L ${f(x)} ${f(y)} L ${f(x - 9)} ${f(y + 6)} Z`,
    };
}

/**
 * The thin lines from the pointer into the three best fits' rows while an
 * event is dragged over the lane grid (A30): each Plan's metro-S out of the
 * pointer to its row's leading edge, 1.5 wide, or its stub toward a row out of
 * the rows' view; none once the pointer is within 12px of the riser or outside
 * the panes under their head, and none into a row the narrowing hides.
 *
 * @param x - The pointer, across the layer
 * @param y - The pointer, down the layer
 * @param ranks - The three best fits, best first
 * @param rows - Each shown resource row's index, by key
 * @param view - Where the links run
 * @returns The lines, best first
 */
export function guideLines(x: number, y: number, ranks: readonly string[], rows: ReadonlyMap<string, number>, view: LinkView): LinkLine[] {
    if (x >= view.channelRight - RIBBON_RISER - GUIDE_CLEAR || y <= 0 || y >= view.height) return [];
    const from: RibbonEnd = { leftX: x, rightX: x, top: y, bottom: y };
    return ranks.flatMap(key => {
        const row = rows.get(key);
        if (row === undefined) return [];
        const route = routeRibbon(from, inView(rowEnd(row, view), view.height), 1.5);
        return [{ stroke: route.stroke, head: route.head }];
    });
}
