/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The links' look on a Canvas2D surface (#1403): what the SVG layer
 * (`layer.tsx`) draws, drawn by a painter, for a host whose links are painted —
 * the Schematic's links and nets — so the three builders' links draw alike. The
 * host routes its links in its own px and hands them here with the shared
 * part's colours and caption font, as its theme probe reads them
 * (`linkRibbons`):
 *
 * - every run of a link stroked at its weight in the muted ink — or its own
 *   tone's — over a paper casing one px either side, and every link's casing
 *   under every link's ink;
 * - its corners turned round, circular, at its corner's radius, clamped to half
 *   of each run beside them ({@link traceRoute}, beside `geometry.ts`'
 *   `rounded`);
 * - a head 8 long and max(8, 2 × weight) wide where it arrives ({@link arrive}),
 *   cased as its line is;
 * - the selected links, then the lit one, drawn last, in the strong ink, the
 *   ends they join ringed 1px four outside them;
 * - each caption on its paper knockout 12 tall, 4 either side of its text, over
 *   every link, outlined while its link is selected.
 *
 * Its measures are the layer's own (`look.ts`); its colours and its font are
 * the part's, never its own. Pure over the context: no React, no DOM.
 *
 * @packageDocumentation
 */

import {
    LINK_CASING, LINK_HALO_OUT, LINK_HALO_R, LINK_HEAD_LEN, LINK_KNOCKOUT_H, LINK_KNOCKOUT_PAD, LINK_KNOCKOUT_RISE, linkHeadHalf,
} from "./look.js";

/** A point on the surface, in its px. */
export interface CanvasPoint {
    readonly x: number;
    readonly y: number;
}

/**
 * What links draw in: the colours and the caption's font the page computes for
 * the shared part's elements (`linkRibbons`), each a CSS colour the context
 * takes.
 */
export interface CanvasLinkLook {
    /** The paper under a link's ink and its head: its casing. */
    readonly casing: string;
    /** The muted ink every link draws in. */
    readonly ink: string;
    /** The strong ink a lit or a selected link draws in. */
    readonly strong: string;
    /** The ring round the ends a lit or a selected link joins. */
    readonly ring: string;
    /** The ring's width (px). */
    readonly ringWidth: number;
    /** The paper a caption sits on. */
    readonly knockout: string;
    /** A selected link's caption's outline. */
    readonly outline: string;
    /** A caption's ink. */
    readonly caption: string;
    /** A caption's font, as `ctx.font` takes it. */
    readonly captionFont: string;
}

/** One run of a link's line: its points, its weight, and what it draws in over its link's. */
export interface CanvasStroke {
    /** Its points, in order. */
    readonly points: readonly CanvasPoint[];
    /** Its weight: its stroke's width (px). */
    readonly width: number;
    /** The radius its corners turn at, before their clamp; 0 turns none. */
    readonly corner: number;
    /** Its alpha over its link's: a net's leg to an item drawn as context fades with it. */
    readonly alpha?: number | undefined;
    /** Its ink over its link's: a leg drained of its colour with the item it joins. */
    readonly ink?: string | undefined;
    /** Whether it draws in the strong ink, its link lit or not: a net's selected leg. */
    readonly strong?: boolean | undefined;
}

/** A head: its tip where its link arrives, its base on its line, how far it reaches either side, and what it draws in over its link's. */
export interface CanvasHead {
    /** Its tip, where its link arrives. */
    readonly tip: CanvasPoint;
    /** Its base's middle, on its link's line. */
    readonly base: CanvasPoint;
    /** How far it reaches either side of its line (px). */
    readonly half: number;
    /** Its alpha over its link's. */
    readonly alpha?: number | undefined;
    /** Its ink over its link's. */
    readonly ink?: string | undefined;
    /** Whether it draws in the strong ink, its link lit or not. */
    readonly strong?: boolean | undefined;
}

/** An end a link joins, which its ring goes round while it is lit or selected: a box, or a circle. */
export type CanvasEnd =
    | { readonly kind: "box"; readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
    | { readonly kind: "circle"; readonly x: number; readonly y: number; readonly r: number };

/** A link's caption: its text, centred across `x`, its baseline at `y`. */
export interface CanvasCaption {
    readonly text: string;
    readonly x: number;
    readonly y: number;
}

/** One link as the painter draws it: its runs, its heads and its joins, how it draws, the ends it joins and its caption. */
export interface CanvasLink {
    /** Its identity among the links. */
    readonly id: string;
    /** Its runs: a link's one, a net's trunk, bars and legs. */
    readonly strokes: readonly CanvasStroke[];
    /** Its heads, each where it arrives. */
    readonly heads: readonly CanvasHead[];
    /** Where its runs join — a net's junctions — each a dot of its radius, in its ink. */
    readonly dots: readonly { readonly x: number; readonly y: number; readonly r: number }[];
    /** Its dash; empty for a solid line. */
    readonly dash: readonly number[];
    /** Its ink — its tone's — or, `undefined`, the look's muted ink. */
    readonly ink: string | undefined;
    /** Its alpha: faded, as context. */
    readonly alpha: number;
    /** Whether it is the one under the pointer. */
    readonly lit: boolean;
    /** Whether it is selected. */
    readonly selected: boolean;
    /** The ends it joins, ringed while it is lit or selected. */
    readonly ends: readonly CanvasEnd[];
    /** Its caption; `undefined` for none. */
    readonly caption: CanvasCaption | undefined;
}

/**
 * Traces a route into the context's path: straight runs between its points,
 * each corner turned on a circle of `corner`'s radius, clamped so the turn
 * takes at most half of each run beside it — the canvas's trace of what
 * `geometry.ts`' `rounded` writes as path data, at any angle. A point that turns
 * nothing, or turns back on itself, is passed straight through. The caller
 * begins the path and strokes it.
 *
 * @param ctx - The context
 * @param points - The route's points, in order
 * @param corner - The corners' radius, before their clamp; 0 turns none
 */
export function traceRoute(ctx: CanvasRenderingContext2D, points: readonly CanvasPoint[], corner: number): void {
    const first = points[0];
    if (first === undefined) return;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length - 1; i++) {
        const a = points[i - 1]!, p = points[i]!, b = points[i + 1]!;
        const inLen = Math.hypot(p.x - a.x, p.y - a.y), outLen = Math.hypot(b.x - p.x, b.y - p.y);
        if (corner <= 0 || inLen < 1e-6 || outLen < 1e-6) { ctx.lineTo(p.x, p.y); continue; }
        // The turn's deflection, 0 straight on and π back on itself: a circle of radius r meets each run r·tan(δ/2) from the corner.
        const cos = ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (inLen * outLen);
        const tangent = Math.tan(Math.acos(Math.max(-1, Math.min(1, cos))) / 2);
        const r = tangent > 1e-6 && Number.isFinite(tangent) ? Math.min(corner, Math.min(inLen, outLen) / 2 / tangent) : 0;
        if (r < 0.5 || tangent > 1e6) { ctx.lineTo(p.x, p.y); continue; }
        ctx.arcTo(p.x, p.y, b.x, b.y, r);
    }
    const last = points[points.length - 1]!;
    if (points.length > 1) ctx.lineTo(last.x, last.y);
}

/**
 * Traces a head into the context's path: a triangle, its base across its line
 * at `base`, `half` either side, its tip at `tip`. The caller begins the path
 * and fills it.
 *
 * @param ctx - The context
 * @param head - The head
 */
export function traceHead(ctx: CanvasRenderingContext2D, head: CanvasHead): void {
    const dx = head.tip.x - head.base.x, dy = head.tip.y - head.base.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const nx = (-dy / len) * head.half, ny = (dx / len) * head.half;
    ctx.moveTo(head.base.x + nx, head.base.y + ny);
    ctx.lineTo(head.tip.x, head.tip.y);
    ctx.lineTo(head.base.x - nx, head.base.y - ny);
    ctx.closePath();
}

/**
 * Where a route arrives: its line, to the head's base, and its head, 8 back
 * along it from its last point — its tip there — max(8, 2 × weight) wide. A
 * route shorter than a head is all head.
 *
 * @param points - The route's points, its last where it arrives
 * @param weight - Its weight: its stroke's width (px)
 * @returns Its line, and its head; `undefined` for a route of no length
 */
export function arrive(points: readonly CanvasPoint[], weight: number): { readonly line: CanvasPoint[]; readonly head: CanvasHead } | undefined {
    const tip = points[points.length - 1];
    if (tip === undefined) return undefined;
    // Walk back from the tip a head's length: the base is where the walk ends, the line every point before it.
    let left = LINK_HEAD_LEN;
    for (let i = points.length - 1; i > 0; i--) {
        const p = points[i]!, a = points[i - 1]!;
        const seg = Math.hypot(p.x - a.x, p.y - a.y);
        if (seg >= left) {
            const t = seg > 0 ? left / seg : 0;
            const base = { x: p.x + (a.x - p.x) * t, y: p.y + (a.y - p.y) * t };
            return { line: [...points.slice(0, i), base], head: { tip, base, half: linkHeadHalf(weight) } };
        }
        left -= seg;
    }
    const base = points[0]!;
    if (Math.hypot(tip.x - base.x, tip.y - base.y) < 1e-9) return undefined;
    return { line: [], head: { tip, base, half: linkHeadHalf(weight) } };
}

/** A link's casing: the paper one px either side of each of its runs, round its heads and its joins. */
function paintCasing(ctx: CanvasRenderingContext2D, link: CanvasLink, look: CanvasLinkLook): void {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineJoin = "round";
    ctx.strokeStyle = look.casing;
    ctx.fillStyle = look.casing;
    for (const stroke of link.strokes) {
        ctx.globalAlpha = link.alpha * (stroke.alpha ?? 1);
        ctx.lineWidth = stroke.width + 2 * LINK_CASING;
        ctx.beginPath();
        traceRoute(ctx, stroke.points, stroke.corner);
        ctx.stroke();
    }
    // A head's casing is the head grown by the casing every way: filled, and stroked round its corners.
    ctx.lineWidth = 2 * LINK_CASING;
    for (const head of link.heads) {
        ctx.globalAlpha = link.alpha * (head.alpha ?? 1);
        ctx.beginPath();
        traceHead(ctx, head);
        ctx.fill();
        ctx.stroke();
    }
    ctx.globalAlpha = link.alpha;
    for (const dot of link.dots) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r + LINK_CASING, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** A link's ink: each run at its weight, its heads and its joins — the strong ink while it is lit or selected. */
function paintInk(ctx: CanvasRenderingContext2D, link: CanvasLink, look: CanvasLinkLook): void {
    const raised = link.lit || link.selected;
    const inkOf = (part: { readonly ink?: string | undefined; readonly strong?: boolean | undefined }): string =>
        (raised || part.strong === true ? look.strong : part.ink ?? link.ink ?? look.ink);
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "butt";
    ctx.setLineDash(link.dash);
    for (const stroke of link.strokes) {
        ctx.globalAlpha = link.alpha * (stroke.alpha ?? 1);
        ctx.strokeStyle = inkOf(stroke);
        ctx.lineWidth = stroke.width;
        ctx.beginPath();
        traceRoute(ctx, stroke.points, stroke.corner);
        ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const head of link.heads) {
        ctx.globalAlpha = link.alpha * (head.alpha ?? 1);
        ctx.fillStyle = inkOf(head);
        ctx.beginPath();
        traceHead(ctx, head);
        ctx.fill();
    }
    ctx.globalAlpha = link.alpha;
    ctx.fillStyle = inkOf({});
    for (const dot of link.dots) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** The ring round each end a lit or a selected link joins: 1px, four outside it — a box's corners round, a circle's about it. */
function paintRings(ctx: CanvasRenderingContext2D, link: CanvasLink, look: CanvasLinkLook): void {
    ctx.save();
    ctx.globalAlpha = link.alpha;
    ctx.setLineDash([]);
    ctx.lineWidth = look.ringWidth;
    ctx.strokeStyle = look.ring;
    for (const end of link.ends) {
        ctx.beginPath();
        if (end.kind === "circle") ctx.arc(end.x, end.y, end.r + LINK_HALO_OUT, 0, Math.PI * 2);
        else {
            const left = end.left - LINK_HALO_OUT, top = end.top - LINK_HALO_OUT;
            const width = Math.max(2, end.right - end.left) + 2 * LINK_HALO_OUT, height = end.bottom - end.top + 2 * LINK_HALO_OUT;
            if (typeof ctx.roundRect === "function") ctx.roundRect(left, top, width, height, Math.min(LINK_HALO_R, width / 2, height / 2));
            else ctx.rect(left, top, width, height);
        }
        ctx.stroke();
    }
    ctx.restore();
}

/** A link's caption on its paper knockout, 4 either side of its text — outlined while its link is selected. */
function paintCaption(ctx: CanvasRenderingContext2D, link: CanvasLink, look: CanvasLinkLook): void {
    const caption = link.caption;
    if (caption === undefined) return;
    ctx.save();
    ctx.globalAlpha = link.alpha;
    ctx.font = look.captionFont;
    const half = ctx.measureText(caption.text).width / 2 + LINK_KNOCKOUT_PAD;
    ctx.beginPath();
    ctx.rect(caption.x - half, caption.y - LINK_KNOCKOUT_RISE, 2 * half, LINK_KNOCKOUT_H);
    ctx.fillStyle = look.knockout;
    ctx.fill();
    if (link.selected) {
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = look.outline;
        ctx.stroke();
    }
    ctx.fillStyle = look.caption;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(caption.text, caption.x, caption.y);
    ctx.restore();
}

/**
 * Paints links in the shared look (see the module docs): every link's casing
 * under every link's ink, the selected links and then the lit one last, each
 * its casing, its ink and the rings round its ends, and every caption over them
 * all.
 *
 * @param ctx - The context
 * @param links - The links, in drawing order
 * @param look - What they draw in: the shared part's colours and caption font
 */
export function paintLinks(ctx: CanvasRenderingContext2D, links: readonly CanvasLink[], look: CanvasLinkLook): void {
    const plain = links.filter((link) => !link.lit && !link.selected);
    const raised = [...links.filter((link) => link.selected && !link.lit), ...links.filter((link) => link.lit)];
    for (const link of plain) paintCasing(ctx, link, look);
    for (const link of plain) paintInk(ctx, link, look);
    for (const link of raised) {
        paintCasing(ctx, link, look);
        paintInk(ctx, link, look);
        paintRings(ctx, link, look);
    }
    for (const link of links) paintCaption(ctx, link, look);
}
