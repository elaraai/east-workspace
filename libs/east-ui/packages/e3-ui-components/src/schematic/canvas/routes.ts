/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The links' and the nets' routes on the screen (#180, #189, #1403), and the
 * hit geometry over them: what the painter draws (`paint.ts`), and what a tap,
 * a hover, a drop and a selected link's handles meet (`selection.ts`'
 * `linkAt`), so hit-testing is the drawing (invariant 9). A link is routed
 * between the items it joins — orthogonal or direct, through its bends, two of
 * one pair fanned into lanes — and a net as its bus: its trunk, a bar across
 * each side of several members and a leg from each of them; each end on its
 * item's edge where it draws at the zoom (a card's side, a labelled pin's edge,
 * a dot's rim), its head where it arrives. Pure: no React, no DOM.
 *
 * @packageDocumentation
 */

import { match, type option } from "@elaraai/east";
import { arrive, type CanvasEnd, type CanvasHead } from "../../shared/links/canvas.js";
import { LINK_CORNER } from "../../shared/links/look.js";
import { type ScreenCamera, project } from "./camera";
import type { DrawnItem, DrawnLink, DrawnNet } from "./drawn";
import { MARKER_DOT_RADIUS, markerHitbox } from "./markers";
import { tierSize, type LodTier } from "./model";

/** An Option's value, or `undefined` — East's `match`, as paint.ts reads one: this module loads no renderer. */
const getSomeorUndefined = <T,>(opt: option<T>): T | undefined => match(opt, { some: (value) => value }, undefined);

type Pt = { x: number; y: number };

/** Expand anchors into an axis-aligned point list (one elbow per diagonal).
 *  Exported so link hit-testing routes exactly like the painter (P11 spirit). */
export function orthogonalize(points: Pt[]): Pt[] {
    const out: Pt[] = [];
    for (const next of points) {
        const prev = out[out.length - 1];
        if (prev !== undefined && prev.x !== next.x && prev.y !== next.y) {
            out.push(Math.abs(next.y - prev.y) >= Math.abs(next.x - prev.x)
                ? { x: prev.x, y: next.y }
                : { x: next.x, y: prev.y });
        }
        if (prev === undefined || prev.x !== next.x || prev.y !== next.y) out.push(next);
    }
    return out;
}

/**
 * Segment-wise distance from a screen point to a polyline — the link
 * hit-test's core (routed points, so the clickable path equals the drawn
 * path, including fan lanes). Exported for unit testing.
 *
 * @param pts - the routed points, in order
 * @param sx - screen x
 * @param sy - screen y
 * @returns the minimum distance (Infinity for fewer than 2 points)
 */
export function distanceToPolyline(pts: readonly Pt[], sx: number, sy: number): number {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!, b = pts[i]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / len2)) : 0;
        const d = Math.hypot(sx - (a.x + t * dx), sy - (a.y + t * dy));
        if (d < best) best = d;
    }
    return best;
}

/** Screen-px gap between parallel link lanes (#180 fan-out). */
export const LINK_LANE_GAP = 7;

/**
 * The arc-length midpoint of a polyline (screen space) — where a link's label
 * pill anchors, so it sits centred along the routed path (not the chord).
 * Exported for unit testing.
 *
 * @param pts - the routed points, in order
 * @returns the midpoint (the sole point / origin for degenerate inputs)
 */
export function polylineMidpoint(pts: readonly Pt[]): Pt {
    if (pts.length === 0) return { x: 0, y: 0 };
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    if (total <= 1e-9) return pts[0]!;
    let acc = 0;
    const half = total / 2;
    for (let i = 1; i < pts.length; i++) {
        const seg = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
        if (acc + seg >= half) {
            const t = seg > 0 ? (half - acc) / seg : 0;
            return { x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * t, y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * t };
        }
        acc += seg;
    }
    return pts[pts.length - 1]!;
}

/**
 * Per-link parallel-fan lanes (#180): links sharing an endpoint pair (either
 * direction, no explicit waypoints, both endpoints resolved) would overdraw
 * into one edge — assign each a lane index so the painter can translate the
 * whole routed polyline rigidly along the pair's perpendicular. Deterministic
 * (lanes ordered by link key). Exported for unit testing.
 *
 * @param links - the links about to paint (pre-filtered upstream is fine)
 * @param eligible - whether a link participates (endpoints resolved, no `via`, not hidden)
 * @returns link key → `{ i, n }` lane position, only for groups of 2+
 */
export function parallelLanes<L extends { key: string; from: string; to: string }>(
    links: readonly L[],
    eligible: (link: L) => boolean,
): Map<string, { i: number; n: number }> {
    const groups = new Map<string, string[]>();
    for (const link of links) {
        if (!eligible(link)) continue;
        const pair = link.from < link.to ? `${link.from}\x00${link.to}` : `${link.to}\x00${link.from}`;
        const g = groups.get(pair);
        if (g !== undefined) g.push(link.key); else groups.set(pair, [link.key]);
    }
    const lanes = new Map<string, { i: number; n: number }>();
    for (const keys of groups.values()) {
        if (keys.length < 2) continue;
        keys.sort();
        keys.forEach((k, i) => lanes.set(k, { i, n: keys.length }));
    }
    return lanes;
}

/** One side of a net resolved to bus-bar geometry (world space). */
interface NetSide {
    /** Where the trunk attaches (bar tap for a multi-endpoint side, the item centre for a single one). */
    anchor: Pt;
    /** The header-bar segment, when this side has 2+ spread endpoints. */
    bar?: [Pt, Pt];
    /** Axis-aligned stub from each endpoint to its bar tap. */
    stubs: Pt[][];
    /** Junction DOTS — taps strictly inside the bar span (3-way joins); bar-end taps are elbows, no dot. */
    taps: Pt[];
}

/** Net (bus / trunk) geometry, world space — shared verbatim by the
 *  painter and the hit-test so the clickable shape equals the drawn one. */
/** The leg a net's stub draws: the side it is on, and its member's place in that side. */
export interface NetStubLeg {
    end: "source" | "destination";
    index: number;
}

export interface NetGeometry {
    /** Trunk polyline: source anchor → via… → destination anchor. */
    trunk: Pt[];
    bars: Array<[Pt, Pt]>;
    stubs: Pt[][];
    /**
     * Each stub's leg, in the stubs' order (#1388): a side with one member —
     * or its members at one point — draws no stub, so a stub's place among the
     * stubs alone doesn't name its leg.
     */
    legs: NetStubLeg[];
    taps: Pt[];
}

/** Resolve one endpoint group to a header BAR + stubs (the bus-bar
 *  convention of a one-line diagram), or a bare anchor when the group is a
 *  single point.
 *
 *  The bar runs along the group's larger spread axis, offset from the
 *  cluster TOWARD the trunk (30% of the gap, clamped to [0.9, 3] world
 *  units) so stubs stay short and the bar never spears the items. */
function netSide(pts: readonly Pt[], toward: Pt): NetSide {
    const centroid: Pt = {
        x: pts.reduce((a, q) => a + q.x, 0) / pts.length,
        y: pts.reduce((a, q) => a + q.y, 0) / pts.length,
    };
    if (pts.length === 1) return { anchor: pts[0]!, stubs: [], taps: [] };
    const minX = Math.min(...pts.map(q => q.x)), maxX = Math.max(...pts.map(q => q.x));
    const minY = Math.min(...pts.map(q => q.y)), maxY = Math.max(...pts.map(q => q.y));
    const vertical = (maxY - minY) >= (maxX - minX);
    // Coordinates along the bar (axis) and across it (perp).
    const axis = (q: Pt): number => vertical ? q.y : q.x;
    const perp = (q: Pt): number => vertical ? q.x : q.y;
    const mk = (a: number, pp: number): Pt => vertical ? { x: pp, y: a } : { x: a, y: pp };
    const lo = vertical ? minY : minX, hi = vertical ? maxY : maxX;
    if (hi - lo < 1e-6) return { anchor: centroid, stubs: [], taps: [] };
    // Bar offset: from the cluster edge FACING the trunk, toward it.
    const dir = Math.sign(perp(toward) - perp(centroid)) || 1;
    const edge = dir > 0 ? Math.max(...pts.map(perp)) : Math.min(...pts.map(perp));
    const gap = Math.abs(perp(toward) - edge);
    const barPerp = edge + dir * Math.min(Math.max(gap * 0.3, 0.9), 3);
    const anchor = mk(Math.min(Math.max(axis(toward), lo), hi), barPerp);
    const stubs = pts.map(q => [q, mk(axis(q), barPerp)]);
    const isEnd = (a: number): boolean => a - lo < 1e-6 || hi - a < 1e-6;
    const taps: Pt[] = [];
    const pushTap = (q: Pt): void => {
        if (isEnd(axis(q))) return;
        if (!taps.some(t => Math.abs(t.x - q.x) < 1e-6 && Math.abs(t.y - q.y) < 1e-6)) taps.push(q);
    };
    for (const st of stubs) pushTap(st[1]!);
    pushTap(anchor);
    return { anchor, bar: [mk(lo, barPerp), mk(hi, barPerp)], stubs, taps };
}

/** Bus-bar geometry for a whole net: each side becomes a header bar (or a
 *  bare anchor), the trunk runs bar-tap → `via`… → bar-tap. With one
 *  endpoint per side and no waypoints this degrades to a plain link. */
export function netGeometry(sources: readonly Pt[], destinations: readonly Pt[], via: readonly Pt[]): NetGeometry {
    const centroid = (qs: readonly Pt[]): Pt => ({
        x: qs.reduce((a, q) => a + q.x, 0) / qs.length,
        y: qs.reduce((a, q) => a + q.y, 0) / qs.length,
    });
    const srcToward = via.length > 0 ? via[0]! : centroid(destinations);
    const dstToward = via.length > 0 ? via[via.length - 1]! : centroid(sources);
    const src = netSide(sources, srcToward);
    const dst = netSide(destinations, dstToward);
    const bars: Array<[Pt, Pt]> = [];
    if (src.bar) bars.push(src.bar);
    if (dst.bar) bars.push(dst.bar);
    return {
        trunk: [src.anchor, ...via, dst.anchor],
        bars,
        stubs: [...src.stubs, ...dst.stubs],
        legs: [
            ...src.stubs.map((_, index): NetStubLeg => ({ end: "source", index })),
            ...dst.stubs.map((_, index): NetStubLeg => ({ end: "destination", index })),
        ],
        taps: [...src.taps, ...dst.taps],
    };
}

// ---- The links' routes on the screen (#1403) ----------------------------------------------------------------

/** Where an item draws at the zoom, in the canvas's px — a card's box, a labelled pin's, a dot's circle: what a link's end meets. */
export type EndShape = CanvasEnd;

/**
 * Where an item draws at the zoom, in the canvas's px (#1403): its card's box,
 * its labelled pin's — the box a tap meets it in ({@link markerHitbox}) — or
 * its dot's circle. A card's box is its card's size as the page lays it out,
 * or, unmeasured, the size the declutter reckons it at (`tierSize`).
 *
 * @param item - The item, where it draws
 * @param tier - What it draws as at the zoom
 * @param cam - The screen camera
 * @param measure - A label's width in px, in the pins' font
 * @param card - Its card's size as the page lays it out; `undefined`, unmeasured
 * @returns Its shape
 */
export function endShape(item: DrawnItem, tier: LodTier, cam: ScreenCamera, measure: (text: string) => number, card: { readonly w: number; readonly h: number } | undefined): EndShape {
    const { sx, sy } = project(item.x, item.y, cam);
    if (tier === "dot") return { kind: "circle", x: sx, y: sy, r: MARKER_DOT_RADIUS };
    if (tier === "label") {
        const pin = markerHitbox(item, "label", cam, measure);
        if (pin.kind === "rect") return { kind: "box", left: pin.left, top: pin.top, right: pin.left + pin.w, bottom: pin.top + pin.h };
    }
    const size = card ?? tierSize(item, "card", cam.ppu);
    return { kind: "box", left: sx - size.w / 2, top: sy - size.h / 2, right: sx + size.w / 2, bottom: sy + size.h / 2 };
}

/** Whether a point lies in a shape, its edge among it. */
function inShape(shape: EndShape, p: Pt): boolean {
    return shape.kind === "circle"
        ? Math.hypot(p.x - shape.x, p.y - shape.y) <= shape.r
        : p.x >= shape.left && p.x <= shape.right && p.y >= shape.top && p.y <= shape.bottom;
}

/** Where a segment from a point in a shape to one out of it leaves the shape: the last of it the shape holds. */
function leavesAt(shape: EndShape, a: Pt, b: Pt): Pt {
    const dx = b.x - a.x, dy = b.y - a.y;
    let t: number;
    if (shape.kind === "circle") {
        const fx = a.x - shape.x, fy = a.y - shape.y;
        const qa = dx * dx + dy * dy, qb = 2 * (fx * dx + fy * dy), qc = fx * fx + fy * fy - shape.r * shape.r;
        t = qa > 0 ? (-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa) : 0;
    } else {
        const tx = dx > 0 ? (shape.right - a.x) / dx : dx < 0 ? (shape.left - a.x) / dx : Infinity;
        const ty = dy > 0 ? (shape.bottom - a.y) / dy : dy < 0 ? (shape.top - a.y) / dy : Infinity;
        t = Math.min(tx, ty);
    }
    const at = Math.max(0, Math.min(1, t));
    return { x: a.x + dx * at, y: a.y + dy * at };
}

/**
 * A route leaving its source where the source draws (#1403): from the point
 * its line first leaves the source's shape, every point before it dropped. A
 * route that starts outside the shape stands as it is; one the shape holds
 * whole is no route.
 *
 * @param points - The route, from inside the source
 * @param shape - The source's shape
 * @returns The route from the shape's edge
 */
export function leaveShape(points: readonly Pt[], shape: EndShape): Pt[] {
    const first = points[0];
    if (first === undefined || !inShape(shape, first)) return [...points];
    for (let i = 0; i < points.length - 1; i++) {
        if (inShape(shape, points[i + 1]!)) continue;
        return [leavesAt(shape, points[i]!, points[i + 1]!), ...points.slice(i + 1)];
    }
    return [];
}

/**
 * A route meeting its destination where the destination draws (#1403): to the
 * point its line first meets the destination's shape, every point after it
 * dropped — {@link leaveShape} walked from the far end.
 *
 * @param points - The route, into the destination
 * @param shape - The destination's shape
 * @returns The route to the shape's edge
 */
export function meetShape(points: readonly Pt[], shape: EndShape): Pt[] {
    return leaveShape([...points].reverse(), shape).reverse();
}

/** A link's or a net's weight: its style's, else a solid run's 2.5 and a dashed one's 1.5. */
export function edgeWeight(style: DrawnLink["style"]): number {
    return getSomeorUndefined(style.value.weight) ?? (style.type === "solid" ? 2.5 : 1.5);
}

/** One run of a link's or a net's drawing, in the canvas's px. */
export interface EdgeRun {
    /** Its route, from where it leaves to where it arrives — its head's tip, where it has one: what the pointer meets. */
    readonly route: readonly Pt[];
    /** What its line draws: its route, to its head's base where it has one. */
    readonly line: readonly Pt[];
    /** Its head, where it arrives at an item. */
    readonly head: CanvasHead | undefined;
    /** Its weight (px). */
    readonly width: number;
    /** The radius its corners turn at, before their clamp. */
    readonly corner: number;
    /** The net's leg it is — its side and its member — or `undefined`: a link's line, a trunk, a bar. */
    readonly leg: { readonly end: "source" | "destination"; readonly item: string } | undefined;
}

/** What a link or a net draws, in the canvas's px, before its look (#1403). */
export interface EdgeGeometry {
    /** Its runs: a link's line; a net's trunk, its bars and its legs. */
    readonly runs: readonly EdgeRun[];
    /** Where a net's legs join its bars: its junction dots. */
    readonly dots: readonly { readonly x: number; readonly y: number; readonly r: number }[];
    /** The shapes of the items it joins: what its rings go round while it is lit or selected. */
    readonly ends: readonly EndShape[];
    /** A link's ends where its line leaves its source and meets its destination — where its handles stand; none for a net. */
    readonly handles: { readonly from: Pt; readonly to: Pt } | undefined;
    /** Its route's middle — a net's trunk's — where its caption centres; `undefined` with no route to draw. */
    readonly middle: Pt | undefined;
}

/** What a link's or a net's routes are worked out over: the camera, the items' centres and shapes, and the links' lanes. */
export interface RouteEnv {
    /** The screen camera. */
    readonly cam: ScreenCamera;
    /** Each item's centre drawn, in world units, by its id. */
    readonly centers: ReadonlyMap<string, Pt>;
    /** Each item's shape on the screen, by its id; `undefined` for one not drawn. */
    readonly shapeOf: (id: string) => EndShape | undefined;
    /** The links' lanes, by their ids (`parallelLanes`). */
    readonly lanes: ReadonlyMap<string, { i: number; n: number }>;
}

/**
 * What a link's or a net's routes are worked out over, each item's shape
 * worked out once, as it is asked.
 *
 * @param input - The camera, each item drawn and its centre, what each draws as, its card's size, the lanes and a label's width
 * @returns The routes' environment
 */
export function routeEnv(input: {
    readonly cam: ScreenCamera;
    readonly centers: ReadonlyMap<string, Pt>;
    readonly items: ReadonlyMap<string, DrawnItem>;
    readonly tiers: ReadonlyMap<string, LodTier>;
    readonly cardSizes: ReadonlyMap<string, { readonly w: number; readonly h: number }> | undefined;
    readonly lanes: ReadonlyMap<string, { i: number; n: number }>;
    readonly measure: (text: string) => number;
}): RouteEnv {
    const shapes = new Map<string, EndShape | undefined>();
    return {
        cam: input.cam, centers: input.centers, lanes: input.lanes,
        shapeOf: (id) => {
            if (shapes.has(id)) return shapes.get(id);
            const item = input.items.get(id);
            const shape = item === undefined || !input.centers.has(id) ? undefined
                : endShape(item, input.tiers.get(id) ?? "dot", input.cam, input.measure, input.cardSizes?.get(id));
            shapes.set(id, shape);
            return shape;
        },
    };
}

/**
 * A link's drawing on the screen (#1403): routed from its source's centre to
 * its destination's — orthogonal or direct, through its bends, translated
 * rigidly onto its lane — then from where its line leaves its source's shape to
 * where it meets its destination's, its head there.
 *
 * @param link - The link
 * @param env - What its routes are worked out over
 * @returns Its drawing; `undefined` while an item it joins is drawn nowhere
 */
export function linkRoutes(link: DrawnLink, env: RouteEnv): EdgeGeometry | undefined {
    const from = env.centers.get(link.from), to = env.centers.get(link.to);
    if (from === undefined || to === undefined) return undefined;
    const { cam } = env;
    const anchors = [from, ...link.via, to].map((q) => ({ x: q.x * cam.ppu + cam.tx, y: q.y * cam.ppu + cam.ty }));
    // Its fan lane (#180): the whole routed line translated along the pair's perpendicular, so its lanes stay parallel
    // through its elbows and fan at its ends.
    const lane = env.lanes.get(link.key);
    if (lane !== undefined) {
        const a0 = anchors[0]!, a1 = anchors[anchors.length - 1]!;
        const len = Math.hypot(a1.x - a0.x, a1.y - a0.y);
        if (len > 1e-6) {
            const d = (lane.i - (lane.n - 1) / 2) * LINK_LANE_GAP;
            const ox = -(a1.y - a0.y) / len * d, oy = (a1.x - a0.x) / len * d;
            for (const q of anchors) { q.x += ox; q.y += oy; }
        }
    }
    const orthogonal = link.route.type === "orthogonal";
    const corner = link.route.type === "orthogonal" ? getSomeorUndefined(link.route.value.corner) ?? LINK_CORNER : 0;
    const width = edgeWeight(link.style);
    const fromShape = env.shapeOf(link.from), toShape = env.shapeOf(link.to);
    const routed = orthogonal ? orthogonalize(anchors) : anchors;
    const left = fromShape === undefined ? routed : leaveShape(routed, fromShape);
    const route = toShape === undefined ? left : meetShape(left, toShape);
    const ends = [fromShape, toShape].filter((shape): shape is EndShape => shape !== undefined);
    const arrived = arrive(route, width);
    if (arrived === undefined) return { runs: [], dots: [], ends, handles: undefined, middle: undefined };
    return {
        runs: [{ route, line: arrived.line, head: arrived.head, width, corner, leg: undefined }],
        dots: [], ends,
        handles: { from: route[0]!, to: route[route.length - 1]! },
        middle: polylineMidpoint(route),
    };
}

/**
 * A net's drawing on the screen (#1403): its bus (`netGeometry`) — its trunk,
 * a bar across each side of several members, a leg from each of them — its
 * trunk leaving a lone source where it draws and meeting a lone destination so,
 * its head there; each source's leg leaving its member's shape, and each
 * destination's meeting it, its head there. Its trunk and its bars carry no
 * head; its junctions are dots.
 *
 * @param net - The net
 * @param env - What its routes are worked out over
 * @returns Its drawing; `undefined` while a side has no member drawn
 */
export function netRoutes(net: DrawnNet, env: RouteEnv): EdgeGeometry | undefined {
    const sources = net.sources.filter((k) => env.centers.has(k));
    const destinations = net.destinations.filter((k) => env.centers.has(k));
    if (sources.length === 0 || destinations.length === 0) return undefined;
    const geo = netGeometry(sources.map((k) => env.centers.get(k)!), destinations.map((k) => env.centers.get(k)!), net.via);
    const { cam } = env;
    const toScreen = (q: Pt): Pt => ({ x: q.x * cam.ppu + cam.tx, y: q.y * cam.ppu + cam.ty });
    const orthogonal = net.route.type === "orthogonal";
    const routed = (world: readonly Pt[]): Pt[] => { const screen = world.map(toScreen); return orthogonal ? orthogonalize(screen) : screen; };
    const corner = net.route.type === "orthogonal" ? getSomeorUndefined(net.route.value.corner) ?? LINK_CORNER : 0;
    const weight = edgeWeight(net.style);
    const runs: EdgeRun[] = [];
    // A side whose members draw no leg is a lone member — or members at one point — which the trunk itself joins.
    const loneSource = !geo.legs.some((leg) => leg.end === "source");
    const loneDestination = !geo.legs.some((leg) => leg.end === "destination");
    const sourceShape = loneSource ? env.shapeOf(sources[0]!) : undefined;
    const destinationShape = loneDestination ? env.shapeOf(destinations[0]!) : undefined;
    let trunk = routed(geo.trunk);
    if (sourceShape !== undefined) trunk = leaveShape(trunk, sourceShape);
    if (destinationShape !== undefined) trunk = meetShape(trunk, destinationShape);
    // The trunk and the bars carry the trunk's weight; the legs are a step lighter.
    const arrivedTrunk = loneDestination ? arrive(trunk, weight + 1) : undefined;
    if (trunk.length >= 2) runs.push({ route: trunk, line: arrivedTrunk?.line ?? trunk, head: arrivedTrunk?.head, width: weight + 1, corner, leg: undefined });
    for (const bar of geo.bars) {
        const line = bar.map(toScreen);
        runs.push({ route: line, line, head: undefined, width: weight + 1, corner: 0, leg: undefined });
    }
    for (const [i, stub] of geo.stubs.entries()) {
        const leg = geo.legs[i]!;
        const member = leg.end === "source" ? sources[leg.index]! : destinations[leg.index]!;
        const shape = env.shapeOf(member);
        if (leg.end === "source") {
            const route = shape === undefined ? routed(stub) : leaveShape(routed(stub), shape);
            if (route.length >= 2) runs.push({ route, line: route, head: undefined, width: weight, corner, leg: { end: "source", item: member } });
            continue;
        }
        // A destination's leg runs from its bar to its member, and arrives there.
        const toward = routed([stub[stub.length - 1]!, stub[0]!]);
        const route = shape === undefined ? toward : meetShape(toward, shape);
        const arrived = arrive(route, weight);
        if (arrived !== undefined) runs.push({ route, line: arrived.line, head: arrived.head, width: weight, corner, leg: { end: "destination", item: member } });
    }
    return {
        runs,
        dots: geo.taps.map((q) => ({ ...toScreen(q), r: weight + 1.5 })),
        ends: [...sources, ...destinations].flatMap((k) => { const shape = env.shapeOf(k); return shape === undefined ? [] : [shape]; }),
        handles: undefined,
        middle: trunk.length >= 2 ? polylineMidpoint(trunk) : undefined,
    };
}
